pragma solidity ^0.4.0;


contract dkgEnc {

  /**
   * DKG phases:
   *
   * 0) Create the contract with a threshold (t) and
   * number of participants.
   *
   * 1) Each of the participants sends a deposit and
   * a public key address that he owns.
   *
   * (not on contract) - each participant generates t+1
   * random sampled coefficients from the (mod p) field.
   *
   * 2) Each of the participants sends its public commitments
   * (the generator exponentiated t+1 coefficients) and
   * encrypted private commitments for all of the other
   * particpants.
   *
   * 3) Complaint - each participant can send a complaint tx
   * about one of the followings:
   *  a) 2 distinct participants offered the same public commitment
         (one is enough). (TODO)
   *  b) Some participant offered invalid commitment (invalid is:
   *     duplicated, insufficient, unmatching commitments G1 to G2)
   *  c) Umatched private and public commitments.
   *  d) Time out.
   *
   */


  /**
   * Important note: at this point this contract purpose is as a
   * POC only, therefore its security is unreliable.
   */



  struct Participant {
    address ethPk; // Ethereum pk
    uint256[2] encPk; // pk for encryption
    mapping(uint16 => uint256[2]) publicCommitmentsG1; // coefficient index to commitment
    mapping(uint16 => uint256[4]) publicCommitmentsG2;
    // TODO: should be encrypted (and possibly off chain).
    mapping(uint16 => uint256) encPrivateCommitments; // node's index to its commitment
    bool isCommitted;
  }

  enum Phase {Enrollment, Commit, PostCommit, EndSuccess, EndFail} // start from 0


  event PhaseChange(
    Phase phase
  );
  event NewCommit(
    uint16 committerIndex,
    uint256[] pubCommitG1,
    uint256[] pubCommitG2,
    uint256[] prvCommit
  );
  event ParticipantJoined(
    uint16 index
  );


  Phase public curPhase;

  // The curve y^2 = x^3 + a*x + b (x,y in modulo n field)
  uint256 public constant p = 0x30644E72E131A029B85045B68181585D97816A916871CA8D3C208C16D87CFD47;
  uint256 public constant q = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
  //uint256 public constant a = 0;
  //uint256 public constant b = 3;

  // G1 generator (on the curve)
  uint256[2] public g1 = [
  0x0000000000000000000000000000000000000000000000000000000000000001,
  0x0000000000000000000000000000000000000000000000000000000000000002
  ];
  // G2 generator (on the curve)
  uint256[4] public g2 = [
  0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2,
  0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed,
  0x90689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b,
  0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa
  ];

  uint256 public depositWei;


  uint16 public t; // threshold
  uint16 public n; // numer of participants;
  uint16 public curN; // current num of participants

  uint256 public phaseStart;
  uint256 public constant commitTimeout = 100;





  // mapping from node's index to a participant
  mapping(uint16 => Participant) public participants;


  constructor(uint16 threshold, uint16 numParticipants, uint deposit) public
  {
    t = threshold;
    n = numParticipants;
    depositWei = deposit;

    curPhase = Phase.Enrollment;

    if (n <= t || t == 0) {
      revert("wrong input");
    }


    phaseStart = block.number;
  }



  modifier checkDeposit() {
    if (msg.value != depositWei) revert("wrong deposit");
    _;
  }
  modifier checkAuthorizedSender(uint16 index) {
    if (participants[index].ethPk != msg.sender) revert("not authorized sender");
    _;
  }
  modifier beFalse(bool term) {
    if (term) revert();
    _;
  }
  modifier inPhase(Phase phase) {
    if (curPhase != phase) revert("wrong phase");
    _;
  }
  modifier notInPhase(Phase phase) {
    if (curPhase == phase) revert("wrong phase");
    _;
  }



  // Join the DKG (enrollment - phase 1).
  // A point on G1 that represents this participant's pk for encryption have
  // to be published. The publisher have to know the secret that generates
  // this point.
  function join(uint256[2] encPk)
  checkDeposit()
  inPhase(Phase.Enrollment)
  external payable
  returns (uint16 index)
  {
    // TODO: phase timeout, check pk

    uint16 cn = curN;
    address sender = msg.sender;


    // Check the pk isn't registered already
    for (uint16 i = 1; i <= cn; i++) {
      if (participants[i].ethPk == sender) {
        revert("already joined");
      }
    }

    cn++;
    participants[cn] = Participant({ethPk : sender, encPk : encPk, isCommitted : false});

    curN = cn;

    // Abort if capacity on participants was reached
    if (cn == n) {
      curPhase = Phase.Commit;
      emit PhaseChange(Phase.Commit);
    }

    emit ParticipantJoined(cn);
    return cn;
  }


  // Send commitments (phase 2).
  //
  // pubCommitG1 is composed of t+1 commitments to local randomly sampled
  // coefficients. Each commitment should be on the G1 curve (affine
  // coordinates) and therefore it has 2 coordinates. Thus, the input array
  // is of size (2t+2) and the i'th commitment will be in indices (2i) and
  // (2i+1).
  //
  // pubCommitG2 is composed of t+1 commitments to same sampled coefficients
  // from pubCommitG1. Each commitment should be on the G2 curve (affine
  // coordinates) and therefore it has 4 coordinates. Thus, the input array
  // is of size (4t+4) and the i'th commitment will be in indices (4i),(4i+1),
  // (4i+2),(4i+3).
  //
  // prCommit is an array of size n, where the first index matches the
  // first participant (participant index 1) and so forth. The commitment
  // is a calculation on the localy generated polynomial in the particpant's
  // index. This calculation is encrypted by the recevier pk for encryption.
  // The senderIndex private commitment is ignored and can be anything
  // (but can't be skipped).
  //
  // Note that this function does not verifies the committed data, it
  // should be done outside of this contract scope. In case of an
  // invalid committed data use complaints.
  function commit(uint16 senderIndex, uint256[] pubCommitG1,
    uint256[] pubCommitG2, uint256[] encPrCommit)
  inPhase(Phase.Commit)
  checkAuthorizedSender(senderIndex)
  beFalse(participants[senderIndex].isCommitted)
  external
  returns (bool)
  {
    // TODO: phase timeout, make prCommit encrypted, verify sender
    // index matches the sender's address.

    assignCommitments(senderIndex, pubCommitG1, pubCommitG2, encPrCommit);

    uint16 committedNum = curN - 1;
    curN = committedNum;

    if (committedNum == 0) {
      curPhase = Phase.PostCommit;
      phaseStart = block.number;
      emit PhaseChange(Phase.PostCommit);
    }
  }


  // Assigns the commitments to the sender with index of senderIndex.
  function assignCommitments(uint16 senderIndex, uint256[] pubCommitG1,
    uint256[] pubCommitG2, uint256[] prCommit)
  internal
  {
    // TODO: consider merging the following loops to save gas
    uint16 nParticipants = n;

    uint16 threshold = t;

    // Verify input size
    if (pubCommitG1.length != (threshold * 2 + 2)
    || pubCommitG2.length != (threshold * 4 + 4)
    || prCommit.length != nParticipants) {

      revert("input size invalid");
    }

    // Assign public commitments from G1 and G2
    for (uint16 i = 0; i < (threshold + 1); i++) {
      participants[senderIndex].publicCommitmentsG1[i] = [pubCommitG1[2 * i], pubCommitG1[2 * i + 1]];
      participants[senderIndex].publicCommitmentsG2[i] = [
      pubCommitG2[4 * i], pubCommitG2[4 * i + 1], pubCommitG2[4 * i + 2], pubCommitG2[4 * i + 3]
      ];
    }

    // Assign private commitments
    for (i = 1; i <= nParticipants; i++) {
      if (senderIndex != i) {
        participants[senderIndex].encPrivateCommitments[i] = prCommit[i - 1];
      }
    }

    participants[senderIndex].isCommitted = true;
    emit NewCommit(senderIndex, pubCommitG1, pubCommitG2, prCommit);
  }


  // Call this when in Phase.PostCommit for more than commitTimeout
  // blocks and no comlaint has to be made.
  function phaseChange()
  inPhase(Phase.PostCommit)
  external
  {

    uint curBlockNum = block.number;

    if (curBlockNum > (phaseStart + commitTimeout)) {
      curPhase = Phase.EndSuccess;
      emit PhaseChange(Phase.EndSuccess);
      // TODO: return money to all
      slash(0);
    }
    else {
      revert();
    }
  }


  // Returns the group PK.
  // This can only be performed after the DKG has ended. This
  // means only when the current phase is Phase.End .
  function getGroupPK()
  inPhase(Phase.EndSuccess)
  public returns (uint256[2] groupPK)
  {

    uint16 nParticipants = n;
    groupPK = participants[1].publicCommitmentsG1[0];

    for (uint16 i = 2; i <= nParticipants; i++) {
      groupPK = ecadd(groupPK, participants[i].publicCommitmentsG1[0]);
    }
  }



  ////////////////
  // Complaints //
  ////////////////


  // A complaint on some public commit. If for some reason this
  // function fails it will slash the complainer deposit! (unless some
  // unauthorized address made the transaction or the wrong phase).
  //
  // The complaint should be called when the public commitments coming
  // from the G1 group does not match to the ones from G2 group (using pairing).
  function complaintPublicCommit(uint16 complainerIndex, uint16 accusedIndex,
    uint16 pubCommitIndex)
  checkAuthorizedSender(complainerIndex)
  notInPhase(Phase.EndFail)
  notInPhase(Phase.EndSuccess)
  public
  {
    curPhase = Phase.EndFail;
    emit PhaseChange(Phase.EndFail);

    Participant storage accused = participants[accusedIndex];
    if (!accused.isCommitted) {
      slash(complainerIndex);
      return;
    }


    if (pairingCheck(accused.publicCommitmentsG1[pubCommitIndex],
      g2, g1, accused.publicCommitmentsG2[pubCommitIndex])) {

      slash(complainerIndex);
    }
    else {
      slash(accusedIndex);
    }

  }

  // A complaint on some private commitment. If for some reason this
  // function fails it will slash the complainer deposit! (unless some
  // unauthorized address made the transaction or the wrong phase).
  //
  // The complaint should be called when some private commitment does
  // not match to the public commitment.
  // The complainer has to publish the secret key from which its pk
  // for encryption is derived.
  function complaintPrivateCommit(uint16 complainerIndex,
    uint16 accusedIndex,
    uint256 complainerSk)
  checkAuthorizedSender(complainerIndex)
  notInPhase(Phase.EndFail)
  notInPhase(Phase.EndSuccess)
  public
  {
    // TODO: a secret key should be inputted so the encrypted private
    // commitment would reveal, also a check for edge cases has to be
    // done (e.g., when no one has yet committed)

    curPhase = Phase.EndFail;
    emit PhaseChange(Phase.EndFail);


    Participant storage accused = participants[accusedIndex];
    if (!accused.isCommitted) {
      slash(complainerIndex);
      return;
    }

    uint256 encPrvCommit = accused.encPrivateCommitments[complainerIndex];

    if (!isEqualPoints(participants[complainerIndex].encPk, ecmul(g1, complainerSk))) {
      slash(complainerIndex);
      return;
    }

    uint256 prvCommit = uint256(decrypt(accused.encPk, complainerSk, bytes32(encPrvCommit)));

    uint256[2] memory temp;
    uint256[2] memory RHS;
    uint256[2] memory LHS = ecmul(g1, prvCommit);


    for (uint16 i = 0; i < t + 1; i++) {
      temp = (ecmul(accused.publicCommitmentsG1[i], complainerIndex ** i));
      if (i == 0) {
        RHS = temp;
      }
      else {
        RHS = ecadd(RHS, temp);
      }
    }

    if (isEqualPoints(LHS, RHS)) {
      slash(complainerIndex);
    }
    else {
      slash(accusedIndex);
    }
  }



  // Divides the deposited balance in the contract between
  // the enrolled paricipants except for the participant
  // with the slashedIndex. Send slashedIndex = 0 in order
  // to divide it between all the participants (no slashing).
  function slash(uint16 slashedIndex) private {

    uint16 nParticipants = n;
    uint256 amount;
    if (slashedIndex == 0) {
      amount = address(this).balance / nParticipants;
    }
    else {
      amount = address(this).balance / (nParticipants - 1);
    }

    for (uint16 i = 1; i < (nParticipants + 1); i++) {
      if (i != slashedIndex) {
        if (!participants[i].ethPk.send(amount)) {
          revert();
        }
      }
    }
  }

  function decrypt(uint256[2] encrypterPk, uint256 decrypterSk, bytes32 encData)
  internal view
  returns (bytes32 decryptedData)
  {
    bytes32 secret = keccak256(abi.encodePacked(ecmul(encrypterPk, decrypterSk)));
    return encData ^ secret;
  }


  ////////////////////////////////////////////////////////////////////////////


  ////////////////////////////////////////////////////////
  // EC operations - precompiled contracts for bn256 only!
  ////////////////////////////////////////////////////////


  function ecmul(uint256[2] p0, uint256 scalar) public view
  returns (uint256[2] p1)
  {
    uint256[3] memory input;
    input[0] = p0[0];
    input[1] = p0[1];
    input[2] = scalar;

    assembly{
    // call ecmul precompile
      if iszero(call(not(0), 0x07, 0, input, 0x60, p1, 0x40)) {
        revert(0, 0)
      }
    }
  }


  function ecadd(uint256[2] p0,
    uint256[2] p1) public view
  returns (uint256[2] p2)
  {
    uint256[4] memory input;
    input[0] = p0[0];
    input[1] = p0[1];
    input[2] = p1[0];
    input[3] = p1[1];

    assembly{

    // call ecadd precompile
      if iszero(call(not(0), 0x06, 0, input, 0x80, p2, 0x40)) {
        revert(0, 0)
      }
    }
  }


  function pairingCheck(uint256[2] a, uint256[4] x, uint256[2] b, uint256[4] y)
  internal
  returns (bool)
  {
    //returns e(a,x) == e(b,y)
    uint256[12] memory input = [
    a[0], a[1], x[0], x[1], x[2], x[3],
    b[0], p - b[1], y[0], y[1], y[2], y[3]
    ];
    uint[1] memory result;

    assembly {
      if iszero(call(not(0), 0x08, 0, input, 0x180, result, 0x20)) {
        revert(0, 0)
      }
    }
    return result[0] == 1;
  }


  // Return true iff p1 equals to p2 (points on the elliptic curve)
  function isEqualPoints(uint256[2] p1, uint256[2] p2) public pure
  returns (bool isEqual)
  {
    return (p1[0] == p2[0] && p1[1] == p2[1]);
  }


  function getParticipantPkEnc(uint16 participantIndex)
  view
  external
  returns (uint256[2] encPk)
  {
    return participants[participantIndex].encPk;
  }

  function getParticipantPubCommitG1(uint16 participantIndex, uint16 coefIndex)
  view
  external
  returns (uint256[2] publicCommitmentsG1)
  {
    return participants[participantIndex].publicCommitmentsG1[coefIndex];
  }

  function getParticipantPubCommitG2(uint16 participantIndex, uint16 coefIndex)
  view
  external
  returns (uint256[4] publicCommitmentsG2)
  {
    return participants[participantIndex].publicCommitmentsG2[coefIndex];
  }

  function getParticipantPrvCommit(uint16 participantIndex, uint16 committedToIndex)
  view
  external
  returns (uint256 encPrivateCommitments)
  {
    return participants[participantIndex].encPrivateCommitments[committedToIndex];
  }

  function getParticipantIsCommitted(uint16 participantIndex)
  view
  external
  returns (bool isCommitted)
  {
    return participants[participantIndex].isCommitted;
  }
}

/**
 Test parameters:

    n=2
    t=1

 coefficients:
    a0) 54379457673493
    a1) 23950433293405

    b0) 453845345602931234235
    b1) 976507650679506234134

    
 public commitments:
    a0)
    1368041971066725411361239018179403078339688804905262551154469895335979601856
    1618821492510491564023544834479645350362276877645830361512548330678288690656
    a1)
    2631817276443378672842587294280308402376367224288772184477397977654447923479
    10839063031804877909681801875549944362615153185887194276974645822919437293936
    
    
    

    b0)
    13557179362105442634413454166511695479402464592547795407903173557675549038583
    14036788543633373773860064791695546493243519155298095713201690292908488603901
    b1)
    1410561832783565967033505993299263011778160659525151177822679323808323926727
    13048336431799703732972170157397576895462246813007390422018149570212241640252

    

 

 sks for decryption:
    a)9163450 (0x8bd2ba)
    b)197435619 (0xbc4a0e3)

 corresponding pks:
    a)
    8010568142108063162131985722241290538226183630284938005062991216917635380726
    19057704389966790842586953303181803223520621589676400762135428513026389437262
    b)
    20560911457302142627844632840089789900964525435158247870992611991075785849245
    6050521612570208504883690818928114121824160212045800551636642965355310285042

 private commitments:
    fa(2)
    102280324260303
    
    fb(1)
    1430352996282437468369

private commitmente encrypted:
    fa(2)
    0x492cb4e02f3d22db552acd7d0d37ac3813a17bb0f62bbf314443cb5d4dece465
    
    fb(1)
    0x492cb4e02f3d22db552acd7d0d37ac3813a17bb0f62bbf7cce6131901dd9c57b

Group PK:
    5837875810486042432133468170632608166601746087751836698563291230806091472694,
    20890074343725101418521449931290202203738610819454311822513791170653396069990

    ## Join
    ["0x11b5d2263b698dd637fb356ea748350b072265cf1acfaf374201f8e99c5bb5f6","0x2a2247476997f4e72285cc8adc57bb0350a105d8f109e523836fc7611d8deb4e"]
    ["0x2d75104069619e845ea0f055105e3adb22f07fe1206c093880b9fee9942cb99d","0xd60794fcd581fed59e19e802dcc263a5d53f6a04ddebba96a77745474f700f2"]

    ## Commit

    1,
    ["0x30648c8ef4e8e38d2db668db8a4cab5513343aad935530559090e8a51354fc0",
    "0x39438725e6ce47a9b49d4a0b2d90e1cee07d3d7e9a44adb9c0a3cf84078ade0",
    "0x5d18e484aeddc886ba162e2fa4bf8bcc125d32230a3fbea6e39ef74de3d6117",
    "0x17f6b138a7105622c493ac45d228e9c858544c47227f27a548942c2f01d59970"],
    [1,2,3,4,5,6,7,8],
    ["0x0000000000000000000000000000000000000000000000000000000000000000",
    "0x492cb4e02f3d22db552acd7d0d37ac3813a17bb0f62bbf314443cb5d4dece465"]

    2,
    ["0x1df91772c249f1b2a7e539242ed9eb60e1475f159a376614e91de79c644097f7",
    "0x1f088a7004f9c9035af5f4686a5494f576415da8de528c40a67702c5399338fd",
    "0x31e598642c78a683eedf66cf7cd4a35a3dd5b5fd8ea947a1c53ab867154fac7",
    "0x1cd918c17d9ea92a1a3efb8a999d577d06058a1b205e99769bdc06b6686c8b3c"],
    [1,2,3,4,5,6,7,8],
    ["0x492cb4e02f3d22db552acd7d0d37ac3813a17bb0f62bbf7cce6131901dd9c57b",
    "0x0000000000000000000000000000000000000000000000000000000000000000"]


 */