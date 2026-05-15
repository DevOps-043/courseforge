const url = 'https://www.gob.mx/stps/acciones-y-programas/inspeccion-federal-del-trabajo';

fetch(url, {
  method: 'GET',
  redirect: 'follow',
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  }
}).then(async r => {
  console.log('--- FETCH RESULTS ---');
  console.log('Status HTTP:', r.status);
  console.log('Status text:', r.statusText);
  console.log('Redirected URL:', r.url);
  
  const text = await r.text();
  console.log('HTML Length:', text.length);
  const textContent = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log('Text content (stripped) Length:', textContent.length);
  
  console.log('\n--- HEADERS ---');
  for (const [key, value] of r.headers) {
    console.log(`${key}: ${value}`);
  }
  
  console.log('\n--- SOFT 404 PATTERNS ---');
  const soft404Patterns = [
    /page\s*(not|no)\s*found/i,
    /404\s*(error|not found|página)/i,
    /no\s*se\s*encontr(ó|o)/i,
    /<title>[^<]*404[^<]*<\/title>/i,
  ];

  let foundPattern = false;
  for (const pattern of soft404Patterns) {
    const match = pattern.test(text);
    console.log(`${pattern} : ${match}`);
    if (match) foundPattern = true;
  }
  console.log('Is valid by patterns?', !foundPattern);
  
  console.log('\n--- CONTENT SNIPPET ---');
  console.log(textContent.substring(0, 500));
}).catch(console.error);
