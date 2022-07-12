import process from 'node:process';
import Database from 'better-sqlite3';

import { db_utils } from './db.js';
import { initial_menu } from './ui.js';

// TODO: include a more robust argument-parsing system (yargs?)
const db = new Database(process.argv[2]);

const db_info = db_utils(db);

initial_menu(db_info);
