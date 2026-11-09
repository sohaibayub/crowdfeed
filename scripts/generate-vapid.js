// Prints a fresh VAPID key pair for Web Push. Put the two lines in your
// environment (or .env on the host) and restart the server.
import * as webPush from 'web-push';

const keys = webPush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.org');
