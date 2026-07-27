import {
  approveVersions,
  checkApprovedVersions,
  currentVersions,
} from './versions.js';

const command = process.argv[2] ?? 'check';

try {
  if (command === 'approve') {
    await approveVersions();
  } else if (command === 'check') {
    await checkApprovedVersions();
  } else {
    throw new Error('Use check or approve.');
  }
  const versions = await currentVersions();
  process.stdout.write(
    `${command}: prompt=${versions.promptVersion} schema=${versions.schemaVersion} evaluation=${versions.evaluationVersion}\n`,
  );
} catch (error) {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : 'EVAL_VERSION_COMMAND_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
