// Fetches the dev server's index.html and checks the bits step B changed:
// the <html> tag, the brand in the title, and the Arabic font link.
import { get } from 'node:http';

get('http://127.0.0.1:3000/', (res) => {
  let body = '';
  res.on('data', (d) => (body += d));
  res.on('end', () => {
    console.log('status:', res.statusCode);
    console.log('html tag:', (body.match(/<html[^>]*>/) || ['NOT FOUND'])[0]);
    console.log('title:', (body.match(/<title>(.*?)<\/title>/) || [])[1]);
    console.log('description:', (body.match(/name="description" content="(.*?)"/) || [])[1]);
    console.log('has Tufan font:', /family=Tufan/.test(body));
  });
}).on('error', (e) => console.log('ERR', e.message));
