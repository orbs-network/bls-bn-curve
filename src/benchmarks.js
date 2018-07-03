const bls = require('bls-lib')
const nacl = require('tweetnacl')

bls.onModuleInit(() => {
    console.log('Testing BLS & TweetNaCl for key generation -> signing -> verification flow')
    bls.init()

    const sec = bls.secretKey()
    const pub = bls.publicKey()
    const sig = bls.signature()

    bls.secretKeySetByCSPRNG(sec)
    bls.getPublicKey(pub, sec)

    let start = new Date()
    const msg = Buffer.from('hello world')
    bls.sign(sig, sec, msg)

    const v = bls.verify(sig, pub, msg)

    let end = new Date()
    let time = end.getTime() - start.getTime()
    console.log('Finished BLS in', time, 'ms')
    console.log(v)

    bls.free(sec)
    bls.free(sig)
    bls.free(pub)

    const keyPair = nacl.sign.keyPair()

    start = new Date()
    const signedMsg = nacl.sign(msg, keyPair.secretKey)
    const rmsg = nacl.sign.open(signedMsg, keyPair.publicKey)

    end = new Date()
    time = end.getTime() - start.getTime()
    console.log('Finished TweetNaCl in', time, 'ms')
    console.log(Buffer.from(rmsg).toString())
})