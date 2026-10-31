import {PrismaClient as SqliteClient} from '@prisma/client';
import {PrismaClient as PostgresClient} from '@maxtravel/prisma-postgresql';
// Resolve after each operator script has loaded its environment.
export function databaseClient(options){const Client=/^postgres(?:ql)?:/.test(process.env.DATABASE_URL??'')?PostgresClient:SqliteClient;return new Client(options);}
