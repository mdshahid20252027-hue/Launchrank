import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { z } from 'zod';
import { prisma } from './db.js';
import { auth, admin } from './middleware.js';

const app = express();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
      connectSrc: ["'self'", 'https://api.razorpay.com'],
      frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.path !== '/api/webhooks/razorpay') {
    const origin = req.header('origin');
    const allowedOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
    if (origin && origin !== allowedOrigin) return res.status(403).json({ message: 'Request origin not allowed' });
  }
  next();
});

// In production, use HTTPS and a frontend/backend deployment on trusted origins.
const cookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
  maxAge: 7 * 86400000,
};
const wrap = (fn: (req: any, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
const include = { owner: { select: { id: true, name: true } }, _count: { select: { votes: true } } };
const shape = (product: any) => ({ ...product, voteCount: product._count.votes, _count: undefined });

app.get('/api/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));

app.post('/api/auth/register', rateLimit({ windowMs: 900000, limit: 20 }), wrap(async (req, res) => {
  const parsed = z.object({ name: z.string().min(2).max(60), email: z.string().email(), password: z.string().min(8).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid registration details' });
  const email = parsed.data.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) return res.status(409).json({ message: 'Email already registered' });
  const user = await prisma.user.create({ data: { name: parsed.data.name, email, passwordHash: await bcrypt.hash(parsed.data.password, 12) } });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
  res.cookie('launchrank_token', token, cookie).status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

app.post('/api/auth/login', rateLimit({ windowMs: 900000, limit: 30 }), wrap(async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid credentials' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !await bcrypt.compare(parsed.data.password, user.passwordHash)) return res.status(401).json({ message: 'Invalid email or password' });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
  res.cookie('launchrank_token', token, cookie).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));
app.post('/api/auth/logout', (_req: Request, res: Response) => res.clearCookie('launchrank_token', { path: '/' }).json({ message: 'Signed out' }));
app.get('/api/auth/me', auth, (req: Request, res: Response) => res.json({ user: (req as any).user }));

app.get('/api/products', wrap(async (req, res) => {
  const search = String(req.query.search || '').slice(0, 80);
  const products = await prisma.product.findMany({
    where: { status: 'APPROVED', ...(search ? { OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { tagline: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } },
    ] } : {}) }, include, orderBy: { createdAt: 'desc' }, take: 60,
  });
  res.json({ products: products.map(shape) });
}));
app.get('/api/products/leaderboard', wrap(async (_req, res) => {
  const products = await prisma.product.findMany({ where: { status: 'APPROVED' }, include, orderBy: { votes: { _count: 'desc' } }, take: 60 });
  res.json({ products: products.map(shape) });
}));
app.post('/api/products', auth, wrap(async (req, res) => {
  const parsed = z.object({
    name: z.string().min(2).max(60), tagline: z.string().min(8).max(120),
    description: z.string().min(20).max(2000),
    websiteUrl: z.string().url().refine(value => value.startsWith('https://'), 'Use HTTPS URL'),
    category: z.string().min(2).max(40),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || 'Invalid product details' });
  let slug = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (await prisma.product.findUnique({ where: { slug } })) slug += '-' + Date.now().toString(36);
  const product = await prisma.product.create({ data: { ...parsed.data, slug, ownerId: (req as any).user.id }, include });
  res.status(201).json({ product: shape(product) });
}));

// Approved products are public; pending/rejected products are visible only to their owner.
app.get('/api/products/:id', wrap(async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id }, include });
  if (!product) return res.status(404).json({ message: 'Product not found' });
  if (product.status !== 'APPROVED') {
    let viewerId = '';
    try {
      const token = (req as any).cookies?.launchrank_token;
      if (token) viewerId = (jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }).userId;
    } catch { /* Treat invalid sessions as signed out. */ }
    if (viewerId !== product.ownerId) return res.status(404).json({ message: 'Product not found' });
  }
  res.json({ product: shape(product) });
}));
app.get('/api/products/:id/vote-status', auth, wrap(async (req, res) => {
  const userId = (req as any).user.id;
  const vote = await prisma.vote.findUnique({ where: { userId_productId: { userId, productId: req.params.id } } });
  res.json({ hasVoted: Boolean(vote) });
}));
app.post('/api/products/:id/vote', auth, wrap(async (req, res) => {
  const userId = (req as any).user.id;
  const product = await prisma.product.findFirst({ where: { id: req.params.id, status: 'APPROVED' } });
  if (!product) return res.status(404).json({ message: 'Product not found' });
  if (product.ownerId === userId) return res.status(400).json({ message: 'Cannot vote for your own product' });
  try {
    await prisma.vote.create({ data: { userId, productId: product.id } });
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ message: 'You have already voted for this product' });
    throw error;
  }
  res.json({ message: 'Vote recorded' });
}));
app.get('/api/users/me/products', auth, wrap(async (req, res) => {
  const products = await prisma.product.findMany({ where: { ownerId: (req as any).user.id }, include, orderBy: { createdAt: 'desc' } });
  res.json({ products: products.map(shape) });
}));

app.get('/api/users/me/votes', auth, wrap(async (req, res) => {
  const votes = await prisma.vote.findMany({
    where: { userId: (req as any).user.id },
    include: { product: { include } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ votes: votes.map(vote => ({ ...vote, product: shape(vote.product) })) });
}));

app.get('/api/admin/products/pending', auth, admin, wrap(async (_req, res) => {
  const products = await prisma.product.findMany({ where: { status: 'PENDING' }, include });
  res.json({ products: products.map(shape) });
}));
app.post('/api/admin/products/:id/:action', auth, admin, wrap(async (req, res) => {
  if (!['approve', 'reject'].includes(req.params.action)) return res.status(400).json({ message: 'Invalid action' });
  const product = await prisma.product.update({ where: { id: req.params.id }, data: { status: req.params.action === 'approve' ? 'APPROVED' : 'REJECTED' } });
  res.json({ product });
}));

app.post('/api/payments/create-order', auth, wrap(async (req, res) => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ message: 'Payment gateway not configured' });
  const parsed = z.object({ productId: z.string(), packageCode: z.enum(['BOOST_1D', 'FEATURE_7D']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid package' });
  const userId = (req as any).user.id;
  const product = await prisma.product.findFirst({ where: { id: parsed.data.productId, ownerId: userId, status: 'APPROVED' } });
  if (!product) return res.status(404).json({ message: 'Approved owned product not found' });
  const plan = parsed.data.packageCode === 'BOOST_1D' ? { amount: 9900 } : { amount: 49900 };
  const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  const order = await razorpay.orders.create({ amount: plan.amount, currency: 'INR', receipt: 'lr_' + Date.now() });
  const dbOrder = await prisma.order.create({ data: { userId, productId: product.id, amountPaise: plan.amount, razorpayOrderId: order.id } });
  res.status(201).json({ orderId: dbOrder.id, razorpayOrderId: order.id, amount: plan.amount, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, packageCode: parsed.data.packageCode });
}));
app.post('/api/payments/verify', auth, wrap(async (req, res) => {
  const parsed = z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid payment data' });
  if (!process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_KEY_ID) return res.status(503).json({ message: 'Payment gateway not configured' });
  const data = parsed.data;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(data.razorpay_order_id + '|' + data.razorpay_payment_id).digest('hex');
  const expectedBuffer = Buffer.from(expected); const receivedBuffer = Buffer.from(data.razorpay_signature);
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) return res.status(400).json({ message: 'Signature verification failed' });

  const existing = await prisma.order.findFirst({ where: { razorpayOrderId: data.razorpay_order_id, userId: (req as any).user.id } });
  if (!existing) return res.status(404).json({ message: 'Order not found' });
  if (existing.status === 'PAID' && existing.razorpayPaymentId === data.razorpay_payment_id) {
    return res.json({ message: 'Payment already verified. Promotion is active.' });
  }
  if (existing.status !== 'CREATED') return res.status(409).json({ message: 'This order has already been processed' });

  const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  const payment: any = await razorpay.payments.fetch(data.razorpay_payment_id);
  if (payment.order_id !== data.razorpay_order_id || payment.amount !== existing.amountPaise || payment.currency !== 'INR' || payment.status !== 'captured') {
    return res.status(400).json({ message: 'Payment is not captured or amount does not match' });
  }
  const days = existing.amountPaise === 9900 ? 1 : existing.amountPaise === 49900 ? 7 : 0;
  if (!days) return res.status(400).json({ message: 'Unknown payment package amount' });
  await prisma.$transaction(async tx => {
    const changed = await tx.order.updateMany({
      where: { id: existing.id, status: 'CREATED' },
      data: { status: 'PAID', razorpayPaymentId: data.razorpay_payment_id },
    });
    if (changed.count === 1) {
      await tx.promotion.create({ data: { productId: existing.productId, startsAt: new Date(), endsAt: new Date(Date.now() + days * 86400000), active: true } });
    }
  });
  const finalOrder = await prisma.order.findUnique({ where: { id: existing.id } });
  if (finalOrder?.status !== 'PAID' || finalOrder.razorpayPaymentId !== data.razorpay_payment_id) {
    return res.status(409).json({ message: 'Payment is being processed. Refresh your dashboard shortly.' });
  }
  res.json({ message: 'Payment verified. Promotion activated.' });
}));
app.post('/api/webhooks/razorpay', wrap(async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ message: 'Webhook not configured' });
  const signature = req.header('x-razorpay-signature') || '';
  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody) return res.status(400).json({ message: 'Missing raw webhook body' });
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ message: 'Invalid webhook signature' });

  const event = req.body?.event;
  const payment = req.body?.payload?.payment?.entity;
  if (payment?.order_id && event === 'payment.captured') {
    const order = await prisma.order.findFirst({ where: { razorpayOrderId: payment.order_id } });
    if (order && payment.amount === order.amountPaise && payment.currency === 'INR' && payment.status === 'captured') {
      const days = order.amountPaise === 9900 ? 1 : order.amountPaise === 49900 ? 7 : 0;
      if (days) {
        await prisma.$transaction(async tx => {
          const changed = await tx.order.updateMany({
            where: { id: order.id, status: 'CREATED' },
            data: { status: 'PAID', razorpayPaymentId: payment.id },
          });
          if (changed.count === 1) {
            await tx.promotion.create({ data: { productId: order.productId, startsAt: new Date(), endsAt: new Date(Date.now() + days * 86400000), active: true } });
          }
        });
      }
    }
  } else if (payment?.order_id && event === 'payment.failed') {
    await prisma.order.updateMany({
      where: { razorpayOrderId: payment.order_id, status: 'CREATED' },
      data: { status: 'FAILED', ...(payment.id ? { razorpayPaymentId: payment.id } : {}) },
    });
  } else if (event === 'refund.processed') {
    const refund = req.body?.payload?.refund?.entity;
    if (refund?.payment_id && typeof refund.amount === 'number') {
      const paidOrder = await prisma.order.findFirst({ where: { razorpayPaymentId: refund.payment_id, status: 'PAID' } });
      // Only a full refund reverses the promotion; partial refunds keep the purchased placement active.
      if (paidOrder && refund.amount >= paidOrder.amountPaise) {
        await prisma.$transaction([
          prisma.order.updateMany({ where: { id: paidOrder.id, status: 'PAID' }, data: { status: 'REFUNDED' } }),
          prisma.promotion.updateMany({
            where: { product: { orders: { some: { id: paidOrder.id } } }, active: true },
            data: { active: false },
          }),
        ]);
      }
    }
  }
  res.json({ received: true });
}));

app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message || 'Server error' });
});
const port = Number(process.env.PORT || 4000);
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Set JWT_SECRET to 32+ characters');
app.listen(port, () => console.log('LaunchRank API on http://localhost:' + port));
