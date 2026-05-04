const fs = require('fs');
const path = require('path');
const msg = fs.readFileSync(path.join(__dirname, 'xmage-reminder.txt'), 'utf8');
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: msg,
  },
}));
