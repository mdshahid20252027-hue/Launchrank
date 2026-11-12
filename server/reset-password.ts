
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from './src/db.js';

async function resetPassword() {
  const email = process.env.RESET_EMAIL;
  const password = process.env.RESET_PASSWORD;

  if (!email || !password || password.length < 8) {
    throw new Error('Valid email and 8+ character password required');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.update({
    where: { email: email.toLowerCase() },
    data: { passwordHash }
  });

  console.log('Password reset successful!');
  console.log('User:', user.name);
  console.log('Email:', user.email);
  console.log('Role:', user.role);
}

resetPassword()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
