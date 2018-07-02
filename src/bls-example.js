const bls = require('bls-lib')

bls.onModuleInit(() => {
  bls.init()

  blsExample();
  // oldExample1();
});


function blsExample() {

  // Allocate memory to keys and signature, this does not actually create anything

  const sec = bls.secretKey()
  const pub = bls.publicKey()
  const sig = bls.signature()

  // This populates sec with the secret key
  bls.secretKeySetByCSPRNG(sec)

  const msg = 'hello world'

  // Sign message msg with secret key sec, put the resulting signature in sig
  bls.sign(sig, sec, msg)

  console.log(`Message: ${msg}`)
  bls.getPublicKey(pub, sec)

  // Export the public key to a TypedArray and print as a hex string
  const exportedPubKey = bls.publicKeyExport(pub);
  console.log(`PK: ${Buffer.from(exportedPubKey).toString('hex')}`);

  // Export the secret key to a TypedArray and print as a hex string (this is just a test!!)
  const exportedSecretKey = bls.secretKeyExport(sec);
  console.log(`SK: ${Buffer.from(exportedSecretKey).toString('hex')}`);

  // Export the signature to a TypedArray and print as a hex string
  const exportedSig = bls.signatureExport(sig);
  console.log(`SIG: ${Buffer.from(exportedSig).toString('hex')}`);

  // Verify the signed message sig using the public key pub, and the plaintext message msg.
  // Return true if verification successful, o/w false
  const v = bls.verify(sig, pub, msg)
  console.log(`Verified? ${v}`);

  // Free resources
  bls.free(sec)
  bls.free(sig)
  bls.free(pub)
}

// A simpler example of creating keys and sig
function oldExample() {
  const sk1 = bls.secretKey()
  const sk2 = bls.secretKey()

  const pk1 = bls.publicKey()
  const pk2 = bls.publicKey()

  bls.getPublicKey(pk1, sk1)
  bls.getPublicKey(pk2, sk2)

  bls.publicKeyAdd(pk1, pk2)

  bls.secretKeyAdd(sk1, sk2)

  const pk3 = bls.publicKey()
  bls.getPublicKey(pk3, sk1)

  const r = bls.publicKeyIsEqual(pk3, pk1)
  console.log(r)

  bls.freeArray([sk1, sk2, pk1, pk2, pk3])

}