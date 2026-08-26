/**
 * Sets a user's password from the command line.
 *
 * For the case where the seed generated a Super Admin password, printed it
 * once, and nobody wrote it down. You run this yourself, so the password is
 * never typed by anyone else:
 *
 *   pnpm --filter @inventory/api set:password -- --email you@example.com
 *
 * The password is prompted for, never passed as an argument, so it does not
 * reach your shell history or the process list. Input is not echoed.
 */
import './load-env'; // must come first: populates process.env
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Reads a line with echo suppressed. */
function promptHidden(question: string): Promise<string> {
  let muted = false;
  const mutedOut = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) stdout.write(chunk);
      cb();
    },
  });

  const rl = createInterface({ input: stdin, output: mutedOut, terminal: true });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

function checkStrength(password: string): string[] {
  const min = Number(process.env.PASSWORD_MIN_LENGTH ?? 12);
  const problems: string[] = [];
  if (password.length < min) problems.push(`be at least ${min} characters`);
  if (!/[a-z]/.test(password)) problems.push('include a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('include an uppercase letter');
  if (!/[0-9]/.test(password)) problems.push('include a digit');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('include a symbol');
  return problems;
}

async function main(): Promise<void> {
  const email = (arg('email') ?? process.env.SEED_SUPER_ADMIN_EMAIL ?? '')
    .toLowerCase()
    .trim();

  if (!email) {
    console.error('Usage: set:password -- --email you@example.com');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const all = await prisma.user.findMany({ select: { email: true } });
    console.error(`No user with email "${email}".`);
    console.error(`Known accounts: ${all.map((u) => u.email).join(', ') || '(none)'}`);
    process.exit(1);
  }

  const password = await promptHidden(`New password for ${email}: `);
  const again = await promptHidden('Confirm: ');

  if (password !== again) {
    console.error('The two entries do not match.');
    process.exit(1);
  }

  const problems = checkStrength(password);
  if (problems.length) {
    console.error(`Password must ${problems.join(', ')}.`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  // Any session issued against the old password stops working.
  const revoked = await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET_CLI' },
  });

  console.log(`Password updated for ${email}.`);
  console.log(`${revoked.count} existing session(s) revoked.`);
  console.log('Sign in at http://localhost:3000/login');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
