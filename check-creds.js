import fs from 'fs';

console.log('--- Environment variables ---');
console.log('GOOGLE_APPLICATION_CREDENTIALS =', process.env.GOOGLE_APPLICATION_CREDENTIALS || '(not set)');
console.log('GEMINI_API_KEY present =', process.env.GEMINI_API_KEY ? 'YES' : 'NO');
console.log('SERIAL =', process.env.SERIAL || '(not set)');
console.log('');

const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (gac) {
  try {
    const raw = fs.readFileSync(gac, 'utf8');
    const j = JSON.parse(raw);
    console.log('--- Service account JSON summary ---');
    console.log('project_id:', j.project_id || '(not found)');
    console.log('client_email:', j.client_email || '(not found)');
    console.log('type:', j.type || '(not found)');
  } catch (err) {
    console.error('Could not read/parse GOOGLE_APPLICATION_CREDENTIALS file:', err.message);
  }
} else {
  console.log('No GOOGLE_APPLICATION_CREDENTIALS file set; Node will use other ADC sources if available (gcloud, metadata, etc.)');
}

console.log('');
console.log('You can set GOOGLE_APPLICATION_CREDENTIALS in PowerShell like:');
console.log('$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\path\\to\\service-account.json"');
console.log('Or set it in cmd.exe:');
console.log('set GOOGLE_APPLICATION_CREDENTIALS=C:\\path\\to\\service-account.json');
