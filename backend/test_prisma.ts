import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// Standard initialization (no adapter needed anymore!)
const prisma = new PrismaClient();

async function main() {
  try {
    const user = await prisma.user.create({
      data: {
        discordId: '1234567890',
        username: 'test_user',
        avatar: null
      }
    });
    console.log('Successfully created user:', user);
  } catch (e) {
    console.error('Prisma Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();