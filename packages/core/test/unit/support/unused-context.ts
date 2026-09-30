import { DataSource } from 'typeorm';
import { transactionContextOf } from '../../../src/transaction-context';

export const unusedDataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });

export const unusedContext = transactionContextOf(unusedDataSource.manager);
