import express')) {\
    const data = JSON.parse(line);\
    // Let's inspect this step\
    console.log(`Found file view step: ${data.step_index}`);\
    \
    // Check if tool output contains the file contents\
    if (data.content && data.content.includes('import express')) {\
      console.log('Writing original content to server_original_backup.ts...');\
      fs.writeFileSync('c:/Users/dhvnf/Downloads/동전커피/server_original_backup.ts', data.content);\
      found = true;\
    }\
  }\
});\
\
rl.on('close', () => {\
  if (!found) {\
    console.log('No direct content found in logs.');\
  }\
});\
"