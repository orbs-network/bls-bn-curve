pragma solidity ^0.4.0;
contract dkg {
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
           (one is enough).
     *  b) Some participant offered invalid commitment (invalid is: 
     *     duplicated, insufficient, )
     *  c) Time out.
     *  d) 
     *
     */
    /**
     * Important note: at this point this contract purpose is as a
     * POC only, therefore its security in unreliable - moreover
     * it is implemented in a way that allows anyone to easily 
     * calculate all of the other participants' secret keys! 
     */
    struct Participant {
        address pk;
        mapping (uint16 => uint256[2]) publicCommitments; // coefficient index to commitment
        // TODO: should be encrypted (and possibly off chain). 
        mapping (uint16 => uint256) privateCommitments; // node's index to its commitment
        bool isCommited;
    }
    enum Phase { Enrollment, Commit, PostCommit, EndSuccess, EndFail } // start from 0
    event PhaseChange(Phase phase);
    event NewCommit(
        uint16 committerIndex,
        uint256[] pubCommit,
        uint256[] prvCommit
    );
    Phase curPhase;
    
     // The curve y^2 = x^3 + a*x + b (x,y in modulo n field)
    uint256 public constant p = 0x30644E72E131A029B85045B68181585D97816A916871CA8D3C208C16D87CFD47;
    uint256 public constant q = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
    uint256 public constant a = 0;
    uint256 public constant b = 3;
    // Generator (on the curve)
    uint256[2] public g = [
        0x0000000000000000000000000000000000000000000000000000000000000001, 
        0x0000000000000000000000000000000000000000000000000000000000000002
    ];
    uint256 public depositWei;
    
    uint16 public t; // threshold
    uint16 public n; // numer of participants;
    uint16 public curN; // current num of participants
    
    uint256 public phaseStart;
    uint256 public constant commitTimeout = 100;
    // mapping from node's index to a participant
    mapping (uint16 => Participant) public participants;
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
        if (participants[index].pk != msg.sender) revert("not authorized sender");
        _; 
    }
    modifier beFalse(bool term) {
        if (term) revert();
        _;
    }
    modifier inPhase(Phase phase) {
        if(curPhase != phase) revert("wrong phase");
        _;
    }
    modifier notInPhase(Phase phase) {
        if(curPhase == phase) revert("wrong phase");
        _;
    }
    // Join the DKG (enrollment - phase 1).
    function join() 
        checkDeposit()
        inPhase(Phase.Enrollment)
        external payable 
        returns(uint16 index)
    {
        // TODO: phase timeout
        uint16 cn = curN;
        address sender = msg.sender;
        
        // Check the pk isn't registered already
        for(uint16 i = 1; i <= cn; i++) {
            if(participants[i].pk == sender) {
                revert("already joined");
            }
        }
        cn++;
        participants[cn] = Participant({pk: sender, isCommited: false});
        curN = cn;
        // Abort if capacity on participants was reached
        if(cn == n) {
            curPhase = Phase.Commit;
            emit PhaseChange(Phase.Commit);
        }
        return cn;
    }    
    
    
    // Send commitments (phase 2). 
    //
    // pubCommit is composed of t+1 commitments to local randomly sampled
    // coefficients. Each commitment should be on the curve (affine 
    // coordinates) and therefore it has 2 coordinates. Thus, the input array
    // is of size (2t+2) and the i'th commitment will be in indices (2i) and
    // (2i+1).
    // prCommit is an array of size n, where the first index matches the
    // first participant (participant index 1) and so forth. The commitment
    // is a calculation on the localy generated polynomial in the particpant's
    // index. The senderIndex private commitment is ignored and can be anything 
    // (but can't be skipped).
    function commit(uint16 senderIndex, uint256[] pubCommit, uint256[] prCommit) 
        inPhase(Phase.Commit)
        checkAuthorizedSender(senderIndex)
        beFalse(participants[senderIndex].isCommited)
        external 
        returns(bool)
    {
        // TODO: phase timeout, make prCommit encrypted, verify sender 
        // index matches the sender's address.
        
        uint16 nParticipants = n;
        // TODO: this check is redundant - remove
        // Check all participants are registered and sender index is valid
        if(senderIndex == 0 || senderIndex > nParticipants) {
            revert("sender index invalid");
        }
        uint16 threshold = t;
        // Verify input size
        if(pubCommit.length != (threshold*2 + 2) || prCommit.length != nParticipants) {
            revert("input size invalid");
        } 
        // TODO: consider merging the following loops to save gas
        // Assign public commitments
        for(uint16 i = 0; i < (threshold+1); i++) {
            participants[senderIndex].publicCommitments[i] = [pubCommit[2*i], pubCommit[2*i+1]];
        }
        // Assign private commitments
        for(i = 1; i <= nParticipants; i++) {
            if(senderIndex != i) {
                participants[senderIndex].privateCommitments[i] = prCommit[i-1];
            }
        }
        participants[senderIndex].isCommited = true;
        emit NewCommit(senderIndex, pubCommit, prCommit);
        uint16 committedNum = curN - 1;
        curN = committedNum;
        if(committedNum == 0) {
            curPhase = Phase.PostCommit; 
            phaseStart = block.number;
            emit PhaseChange(Phase.PostCommit);
        }
    }
    function phaseChange() 
        inPhase(Phase.PostCommit)
        external 
    {
        uint curBlockNum = block.number;
        if(curBlockNum > (phaseStart+commitTimeout)) {
            curPhase = Phase.EndSuccess; 
            emit PhaseChange(Phase.EndSuccess);
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
        public returns(uint256[2] groupPK)
    {
        uint16 nParticipants = n;
        groupPK = participants[1].publicCommitments[0];
        for(uint16 i = 2; i <= nParticipants; i++) {
            groupPK = ecadd(groupPK, participants[i].publicCommitments[0]);
        }
    }
    ////////////////
    // Complaints //
    ////////////////
    // A complaint on some private commitment. If for some reason this
    // function fails it will slash the complainer deposit! (unless some
    // unauthorized address made the transaction or the wrong phase).
    function complaintPrivateCommit(uint16 complainerIndex,
                                    uint16 accusedIndex)
        checkAuthorizedSender(complainerIndex)
        notInPhase(Phase.EndFail)
        notInPhase(Phase.EndSuccess)
        public 
        returns (bool) 
    {
        // TODO: a secret key should be inputted so the encrypted private
        // commitment would reveal, also a check for edge cases has to be
        // done (e.g., when no one has yet committed)
        curPhase = Phase.EndFail;
        emit PhaseChange(Phase.EndFail);
        uint16 nParticipants = n;
        // Check for valid indices 
        if(complainerIndex == 0 || complainerIndex > nParticipants ||
           accusedIndex == 0 || accusedIndex > nParticipants) {
            slash(complainerIndex);
        }
        Participant storage accused = participants[accusedIndex];
        if(!accused.isCommited) {
            slash(complainerIndex);
        }
        uint256 prvCommit = accused.privateCommitments[complainerIndex];
        uint256[2] memory temp;
        uint256[2] memory RHS;
        uint256[2] memory LHS = ecmul(g, prvCommit);
        for(uint16 i = 0; i < t+1; i++) {
            temp = (ecmul(accused.publicCommitments[i], complainerIndex**i));
            if(i == 0) {
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
            amount = this.balance/nParticipants;
        }
        else {
            amount = this.balance/(nParticipants-1);
        }
        for (uint16 i = 1; i < (nParticipants+1); i++) {
            if (i != slashedIndex) {
                if (!participants[i].pk.send(amount)) {
                    revert();
                }
            }
        }
    }
////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////
    // EC operations - precompiled contracts for bn256 only!
    ////////////////////////////////////////////////////////
    function ecmul(uint256[2] p0, uint256 scalar) public view
        returns(uint256[2] p1) 
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
        returns(uint256[2] p2) 
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
    // Return true iff p1 equals to p2 (points on the elliptic curve)
    function isEqualPoints(uint256[2] p1, uint256[2] p2) public pure
        returns(bool isEqual)
    {
        return (p1[0] == p2[0] && p1[1] == p2[1]);
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
    
 private commitments:
    fa(2)
    102280324260303
    
    fb(1)
    1430352996282437468369
Group PK:
    5837875810486042432133468170632608166601746087751836698563291230806091472694,
    20890074343725101418521449931290202203738610819454311822513791170653396069990
    
    ## Commit
    1,
    ["0x30648c8ef4e8e38d2db668db8a4cab5513343aad935530559090e8a51354fc0",
    "0x39438725e6ce47a9b49d4a0b2d90e1cee07d3d7e9a44adb9c0a3cf84078ade0",
    "0x5d18e484aeddc886ba162e2fa4bf8bcc125d32230a3fbea6e39ef74de3d6117",
    "0x17f6b138a7105622c493ac45d228e9c858544c47227f27a548942c2f01d59970"],
    ["0x0000000000000000000000000000000000000000000000000000000000000000",
    "0x00000000000000000000000000000000000000000000000000005d05fe6521cf"]
    2,
    ["0x1df91772c249f1b2a7e539242ed9eb60e1475f159a376614e91de79c644097f7",
    "0x1f088a7004f9c9035af5f4686a5494f576415da8de528c40a67702c5399338fd",
    "0x31e598642c78a683eedf66cf7cd4a35a3dd5b5fd8ea947a1c53ab867154fac7",
    "0x1cd918c17d9ea92a1a3efb8a999d577d06058a1b205e99769bdc06b6686c8b3c"],
    ["0x00000000000000000000000000000000000000000000004d8a22a7c8ae5000d1",
    "0x0000000000000000000000000000000000000000000000000000000000000000"]
 */