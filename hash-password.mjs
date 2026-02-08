#!/usr/bin/env node
import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password) {
  console.log('Usage: node hash-password.mjs <password>');
  console.log('');
  console.log('Generates a bcrypt hash for use in config.json');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);
console.log(hash);
