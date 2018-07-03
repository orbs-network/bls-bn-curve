const bls = require('bls-lib')
const dkg = require('dkg')

bls.onModuleInit(() => {
    // We are going to walk through Distributed Key Generation.
    // In DKG a group of members generate a "shared secret key" that none of them
    // know individal and public key. When a threshold amount of group members agree to sign on
    // the same message then then anyone can combine the signatures into a single
    // signature that can be verified against the groups public key
    //
    // The result of dkg be 1) each member will generate a secret key used to
    // sign messages for the group. 2) a group verification vector which contains
    // the groups public key as well as the the information need to derive any
    // of the members public key.
    //
    // Overview
    // 1) Each member will "setup" and generate a verification vector and secret
    // key contribution share for every other member
    // 2) Each member post their verification vector publicly
    // 3) Each member sends their key contribution share to each other member
    // 4) When a member receives a contribution share it validates it against
    // the sender's verification vector and saves it
    // 5) After members receive all their contribution shares they compute
    // their secret key for the group

    bls.init()

    // to setup a group first we need a set a threshold. The threshold is the
    // number of group participants needed to create a valid signature for the group
    const threshold = 4

    // each member in the group needs a unique ID. The value of the ID doesn't matter
    // but it does need to be imported into bls-lib as a secret key
    const members = [10314, 30911, 25411, 8608, 31524, 15441, 23399].map(id => {

        // allocate buffer to hold secret key
        const sk = bls.secretKey()

        // generate the secret key given a seed phrase (the ID)
        bls.hashToSecretKey(sk, Buffer.from([id]))

        return {
            id: sk,
            receivedShares: []
        }
    })

    console.log(`Created ${members.length} members`)
    console.log('Beginning the secret instantiation round...')

    // Array of verification vectors - one verification vector for each Member
    // Each verification vector is itself an array so vvecs is an array of arrays
    const vvecs = []

    // Each member creates a verification vector & secret key contribution 
    // for every member in the group (including itself!)

    members.forEach(id => {

        // Generate the secret key contributions array, based on the all members' IDs and the threshold

        const {
            verificationVector, // array of public keys
            secretKeyContribution // array of secret key contributions
        } = dkg.generateContribution(bls, members.map(m => m.id), threshold)

        // the verification vector should be posted publically so that everyone
        // in the group can see it
        vvecs.push(verificationVector)

        // Each secret key (sk) contribution is then encrypted and sent to the member it is for.
        secretKeyContribution.forEach((sk, i) => {
            // when a group member receives its share, it verifies it against the
            // verification vector of the sender and then saves it
            const member = members[i]


            const verified = dkg.verifyContributionShare(bls, member.id, sk, verificationVector)
            if (!verified) {
                throw new Error('invalid share!')
            }
            member.receivedShares.push(sk)
        })
    })

    // Each member adds its secret key contribution shares to get a
    // single secretkey share for the group used for signing message for the group
    members.forEach((member, i) => {
        const sk = dkg.addContributionShares(bls, member.receivedShares)
        member.secretKeyShare = sk
    })
    console.log('-> secret shares have been generated')

    // Now any one can add together all verification vectors posted by the
    // members of the group to get a single verification vector for the group
    // This converts vvecs (an array of arrays) into a single array by reducing each member of vvecs into a single value
    const groupsVvec = dkg.addVerificationVectors(bls, vvecs)
    console.log('-> verification vector computed')

    // the group's verification vector contains the group's public key as its first element
    const groupsPublicKey = groupsVvec[0]

    const pubArray = bls.publicKeyExport(groupsPublicKey)
    console.log('-> group public key : ', Buffer.from(pubArray).toString('hex'))

    console.log('-> testing signature')
    // now we can select any 4 members to sign on a message
    const message = 'hello world'
    const sigs = []
    const signersIds = []

    // Each member signs the message with its secret key share. 
    for (let i = 0; i < threshold; i++) {
        const sig = bls.signature() // allocate buf to hold signature
        bls.sign(sig, members[i].secretKeyShare, message)
        sigs.push(sig)
        signersIds.push(members[i].id)
    }

    // Anyone can combine the signatures to get the group signature
    // the resulting signature will also be the same no matter which members signed
    const groupsSig = bls.signature() // allocate buf to hold signature 
    bls.signatureRecover(groupsSig, sigs, signersIds) // combine the individual signatures into a group signature

    const sigArray = bls.signatureExport(groupsSig)
    const groupSigBuf = Buffer.from(sigArray)
    console.log('->    Group signature: ', groupSigBuf.toString('hex'))

    // Verify the group signature on the message with the group public key
    var verified = bls.verify(groupsSig, groupsPublicKey, message)
    console.log('->    verified group signature with group public key?', Boolean(verified))
    bls.free(groupsSig)

    console.log('-> testing individual public key derivation')
    // we can also use the groups verification vector to derive any of the members
    // public key
    const member = members[4]
    const pk1 = bls.publicKey()
    bls.publicKeyShare(pk1, groupsVvec, member.id)

    const pk2 = bls.publicKey()
    bls.getPublicKey(pk2, member.secretKeyShare)
    console.log('->    are the public keys equal?', Boolean(bls.publicKeyIsEqual(pk1, pk2)))

    console.log('\nBeginning the share renewal round...')

    const newVvecs = [groupsVvec]

    console.log('-> member shares array reinitialized')
    members.forEach(member => {
        member.receivedShares.length = 0
        member.receivedShares.push(member.secretKeyShare)
    })

    console.log('-> running null-secret contribution generator')
    // the process is very similar, only `generateZeroContribution` works with a null secret
    members.forEach(id => {
        const {
            verificationVector,
            secretKeyContribution
        } = dkg.generateZeroContribution(bls, members.map(m => m.id), threshold)
        // the verification vector should be posted publically so that everyone
        // in the group can see it
        newVvecs.push(verificationVector)

        // Each secret key contribution is then encrypted and sent to the member it is for.
        secretKeyContribution.forEach((sk, i) => {
            // when a group member receives its share, it verifies it against the
            // verification vector of the sender and then saves it
            const member = members[i]
            const verified = dkg.verifyContributionShare(bls, member.id, sk, verificationVector)
            if (!verified) {
                throw new Error('invalid share!')
            }
            member.receivedShares.push(sk)
        })
    })

    // now each members adds together all received secret key contributions shares to get a
    // single secretkey share for the group used for signing message for the group
    members.forEach((member, i) => {
        const sk = dkg.addContributionShares(bls, member.receivedShares)
        member.secretKeyShare = sk
    })
    console.log('-> new secret shares have been generated')

    // Now any one can add together the all verification vectors posted by the
    // members of the group to get a single verification vector of for the group
    const newGroupsVvec = dkg.addVerificationVectors(bls, newVvecs)
    console.log('-> verification vector computed')

    // the groups verifcation vector contains the groups public key. The group's
    // public key is the first element in the array
    const newGroupsPublicKey = newGroupsVvec[0]

    verified = (bls.publicKeyIsEqual(newGroupsPublicKey, groupsPublicKey))
    console.log('-> public key should not have changed :', (verified ? 'success' : 'failure'))

    console.log('-> testing signature using new shares')
    // now we can select any 4 members to sign on a message
    sigs.length = 0
    signersIds.length = 0
    for (let i = 0; i < threshold; i++) {
        const sig = bls.signature()
        bls.sign(sig, members[i].secretKeyShare, message)
        sigs.push(sig)
        signersIds.push(members[i].id)
    }

    // then anyone can combine the signatures to get the groups signature
    // the resulting signature will also be the same no matter which members signed
    const groupsNewSig = bls.signature()
    bls.signatureRecover(groupsNewSig, sigs, signersIds)

    const newSigArray = bls.signatureExport(groupsNewSig)
    const newSigBuf = Buffer.from(newSigArray)
    console.log('->    sigtest result : ', newSigBuf.toString('hex'))
    console.log('->    signature comparison :', ((newSigBuf.equals(groupSigBuf)) ? 'success' : 'failure'))

    verified = bls.verify(groupsNewSig, groupsPublicKey, message)
    console.log('->    verified ?', Boolean(verified))
    bls.free(groupsNewSig)

    // don't forget to clean up!
    bls.free(pk1)
    bls.free(pk2)
    bls.freeArray(groupsVvec)
    bls.freeArray(newGroupsVvec)
    members.forEach(m => {
        bls.free(m.secretKeyShare)
        bls.free(m.id)
    })
})