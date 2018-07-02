const bls = require('bls-lib')

bls.onModuleInit(() => {
  bls.init()

  // example1();
  example2();

});

function example1() {
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

function example2() {
  const sec = bls.secretKey()
  const pub = bls.publicKey()
  const sig = bls.signature()

  bls.secretKeySetByCSPRNG(sec)
  const msg = 'hello world'
  bls.sign(sig, sec, msg)
  console.log(`Message: ${msg}`)
  bls.getPublicKey(pub, sec)
  const exportedPubKey = bls.publicKeyExport(pub);
  console.log(`PK: ${Buffer.from(exportedPubKey).toString('hex')}`);
  const exportedSecretKey = bls.secretKeyExport(sec);
  console.log(`SK: ${Buffer.from(exportedSecretKey).toString('hex')}`);
  const exportedSig = bls.signatureExport(sig);
  console.log(`SIG: ${Buffer.from(exportedSig).toString('hex')}`);


  const v = bls.verify(sig, pub, msg)
  console.log(`Verified? ${v}`);
  // v === true

  bls.free(sec)
  bls.free(sig)
  bls.free(pub)
}