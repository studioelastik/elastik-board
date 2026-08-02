/** `npm run keys` — print a VAPID pair for pinning via env vars. */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + publicKey);
console.log('VAPID_PRIVATE_KEY=' + privateKey);
console.log('\nOnly needed if you want the keys in env vars instead of data/vapid.json.');
console.log('Changing them invalidates every device that already subscribed.');
