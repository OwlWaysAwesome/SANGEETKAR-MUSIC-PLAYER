/// <reference types="node" />
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { createClient } from '@libsql/client';

console.log("DATABASE_URL:", process.env.DATABASE_URL);

const libsql = createClient({
  url: 'file:dev.db',
});
const adapter = new PrismaLibSQL(libsql as any);
const prisma = new PrismaClient({ adapter, datasourceUrl: process.env.DATABASE_URL });

async function main() {
  const user = await prisma.user.findFirst();
  console.log(user);
}
main().catch(console.error);
