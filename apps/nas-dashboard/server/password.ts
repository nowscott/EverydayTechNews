import { hashPassword } from './security.ts';
let input = ''; for await (const chunk of process.stdin) input += chunk;
process.stdout.write(hashPassword(input.trimEnd()) + '\n');
