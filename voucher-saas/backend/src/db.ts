import { PrismaClient } from '@prisma/client';

// Cliente Prisma único (reaproveitado entre requisições).
export const prisma = new PrismaClient();
