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
     *
     */



    struct Participant {
        bytes32 pk;
        mapping (uint16 => uint256[2]) publicCommitments; // coefficient index to commitment
        // TODO: should be encrypted (and possibly off chain). 
        mapping (uint16 => uint256) privateCommitments; // node's index to its commitment
        bool isCommited;
    }
    
     // The curve y^2 = x^3 + a*x + b (x,y in modulo n field)
    uint256 public constant p = 0x30644E72E131A029B85045B68181585D97816A916871CA8D3C208C16D87CFD47;
    uint256 public constant q = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
    uint256 public constant a = 0;
    uint256 public constant b = 3;

    // Generator (on the curve)
    uint256[2] public g = [
        0x0000000000000000000000000000000000000000000000000000000000000001, 
        0x0000000000000000000000000000000000000000000000000000000000000002];

    uint256 constant depositGas = 1000;
    uint16 constant phaseTimeBlock = 1000; // time (in blocks) between phases
    

    uint16 public t; // threshold
    uint16 public n; // numer of participants;
    uint16 public curN; // current num of participants
    
    uint256 phaseStart;



    // mapping from node's index to a participant
    mapping (uint16 => Participant) public participants;


    constructor(uint16 threshold, uint16 numParticipants) public 
    {
        t = threshold;
        n = numParticipants;

        if (n <= t || t == 0) {
            revert();
        }


        phaseStart = block.number;
    }


    // Join the DKG (enrollment - phase 1).
    function join(bytes32 pk) external returns(uint16 index)
    {
        // TODO: deposit funds, phase timeout

        uint16 cn = curN;
        
        // Abort if capacity on participants was reached
        if(cn == n) {
            revert();
        }

        // Check the pk isn't registered already
        for(uint16 i = 1; i <= cn; i++) {
            if(participants[i].pk == pk) {
                revert();
            }
        }

        cn++;
        participants[cn] = Participant({pk: pk, isCommited: false});

        curN = cn;
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
    function commit(uint16 senderIndex, uint256[] pubCommit, uint256[] prCommit) external
        returns(bool)
    {
        // TODO: phase timeout, make prCommit encrypted, verify sender 
        // index matches the sender's address.

        uint16 nParticipants = n;

        // Check all participants are registered and sender index is valid
        if(senderIndex == 0 || senderIndex > nParticipants) {
            revert();
        }

        uint16 threshold = t;

        // Verify input size
        if(pubCommit.length != (threshold*2 + 2) || prCommit.length != nParticipants) {
            revert();
        } 

        // Verify sender first commit
        if(participants[senderIndex].isCommited) {
            revert();
        }


        // TODO: consider merging the following loops to save gas

        // Assign public commitments
        for(uint16 i = 0; i < threshold; i++) {
            uint16 arrayPos = 2*i;
            participants[senderIndex].publicCommitments[i][0] = pubCommit[arrayPos];
            participants[senderIndex].publicCommitments[i][1] = pubCommit[arrayPos+1];
        }

        // Assign private commitments
        for(uint8 j = 1; j <= nParticipants; j++) {
            if(senderIndex != j) {
                participants[senderIndex].privateCommitments[j] = prCommit[j-1];
            }
        }
        
    }


    ////////////////
    // Complaints //
    ////////////////

    // A complaint on some private commitment. 
    // 
    function complaintPrivateCommit(uint16 complainerIndex, 
                                    uint16 accusedIndex) public 
        returns (bool) 
    {
        // TODO: refund deposits, a secret key should be inputted so the
        // encrypted private commitment would reveal 

        uint16 nParticipants = n;
        // Check for valid indices 
        if(complainerIndex == 0 || complainerIndex > nParticipants || 
           accusedIndex == 0 || accusedIndex > nParticipants) {
            
            revert();
        }

        Participant accused = participants[accusedIndex];
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

        // TODO slashing
        return isEqualPoints(LHS, RHS);
    }
    


    function getGroupPK() public returns(uint256[2] groupPK)
    {
        // TODO end of commit phase
        uint16 nParticipants = n;
        groupPK = participants[1].publicCommitments[0];

        for(uint16 i = 2; i <= nParticipants; i++) {
            groupPK = ecadd(groupPK, participants[i].publicCommitments[0]);
        }
    }


    function getAllPKs() public 
    {
        
    }



////////////////////////////////////////////////////////////////////////////


    ////////////////////////////////////////////////////////
    // EC operations - precompiled contracts for bn256 only!
    ////////////////////////////////////////////////////////


    function ecmul(uint256[2] p0, uint256 scalar) public view
        returns(uint256[2] p) 
    {
        uint256[3] memory input;
        input[0] = p0[0];
        input[1] = p0[1];
        input[2] = scalar;

        assembly{
            // call ecmul precompile
            if iszero(call(not(0), 0x07, 0, input, 0x60, p, 0x40)) {
                revert(0, 0)
            }
        }
    }


    function ecadd(uint256[2] p0,
                   uint256[2] p1) public view
        returns(uint256[2] p) 
    {
        uint256[4] memory input;
        input[0] = p0[0];
        input[1] = p0[1];
        input[2] = p1[0];
        input[3] = p1[1];

        assembly{
            
            // call ecadd precompile
            if iszero(call(not(0), 0x06, 0, input, 0x80, p, 0x40)) {
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