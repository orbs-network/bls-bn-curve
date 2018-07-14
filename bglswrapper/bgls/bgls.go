package bgls

import (
  "crypto/rand"
  "fmt"
  "math/big"

  . "github.com/Project-Arda/bgls/curves" // nolint: golint
)

// //GetGroupPK turns public commitments into the group's public key
// func GetGroupPK(curve CurveSystem, pubCommit []Point) Point {

// }

//CoefficientGen generates a coefficient secret (*big.Int)
//and points (commitments) in G1 and G2
func CoefficientGen(curve CurveSystem) (*big.Int, Point, Point, error) {
  x, err := rand.Int(rand.Reader, curve.GetG1Order())
  if err != nil {
	return nil, nil, nil, err
  }
  g1Commit := LoadPublicKeyG1(curve, x)
  g2Commit := LoadPublicKeyG2(curve, x)
  return x, g1Commit, g2Commit, nil
}

//LoadPublicKeyG1 turns secret key into a public key of type Point1
func LoadPublicKeyG1(curve CurveSystem, sk *big.Int) Point {
  pubKey := curve.GetG1().Mul(sk)
  return pubKey
}

//LoadPublicKeyG2 turns secret key into a public key of type Point2
func LoadPublicKeyG2(curve CurveSystem, sk *big.Int) Point {
  pubKey := curve.GetG2().Mul(sk)
  return pubKey
}

//GetPrivateCommitment returns a private commitment in the index ind.
//There should be t+1 coefficients
func GetPrivateCommitment(curve CurveSystem, ind *big.Int, coefficients []*big.Int) *big.Int {
  sum := big.NewInt(0).Set(coefficients[0])
  j := big.NewInt(1)
  for i := 1; i < len(coefficients); i++ {
	tmp1 := big.NewInt(0).Exp(ind, j, curve.GetG1Order())
	tmp2 := big.NewInt(0).Mul(tmp1, coefficients[i])
	tmp2.Mod(tmp2, curve.GetG1Order())
	sum.Add(sum, tmp2)
	sum.Mod(sum, curve.GetG1Order())
	j.Add(j, big.NewInt(1))
  }
  return sum
}

//GetGroupPublicKey turns the public commitments from G2 group of
//all participants to the group's PK (in G2). The pubCommitG2 is composed
//of n points each are the commitments to the zero'th coefficient
//(the first coefficient)
func GetGroupPublicKey(curve CurveSystem, pubCommitG2 []Point) Point {
  return AggregatePoints(pubCommitG2)
}

//VerifyPublicCommitment
func VerifyPublicCommitment(curve CurveSystem, pubCommitG1 Point, pubCommitG2 Point) bool {
  paired, _ := curve.PairingProduct(
	[]Point{curve.GetG1().Mul(new(big.Int).SetInt64(-1)), pubCommitG1},
	[]Point{pubCommitG2, curve.GetG2()})
  return curve.GetGTIdentity().Equals(paired)
}

//VerifyPrivateCommitment verifies the private commitment from some participant (j)
//myIndex is the index of the caller (not j - the other examined participant!)
//prvCommit is the private commitment from j (to the accuser, of course)
//pubCommitG1 is all the G1's public commitments from j
func VerifyPrivateCommitment(curve CurveSystem, myIndex *big.Int, prvCommit *big.Int, pubCommitG1 []Point) bool {
  LHS := LoadPublicKeyG1(curve, prvCommit)
  RHS := CalculatePrivateCommitment(curve, myIndex, pubCommitG1)
  return LHS.Equals(RHS)
}

//CalculatePrivateCommitment calculates the commitment to the private commitment of
//participant with index
//pubCommit (G1/G2) is the public commitments of the participant represented by index
func CalculatePrivateCommitment(curve CurveSystem, index *big.Int, pubCommit []Point) Point {
  pubCommitExp := make([]Point, len(pubCommit))
  j := big.NewInt(0)
  for i, pubCommit := range pubCommit {
	scalar := big.NewInt(0).Exp(index, j, curve.GetG1Order())
	pubCommitExp[i] = pubCommit.Mul(scalar)
	j.Add(j, big.NewInt(1))
  }
  return AggregatePoints(pubCommitExp)
}

//GetSecretKey returns the secret key generated after the DKG scheme has done
//
func GetSecretKey(prvCommits []*big.Int) *big.Int {
  sum := big.NewInt(0)
  for i := 0; i < len(prvCommits); i++ {
	sum.Add(sum, prvCommits[i])
  }
  return sum
}

//GetSpecificPublicKey returns a specific participant (index) public key
//pubCommitG2 is the public commitments of all praticipants (composed of (t+1)*n points)!
func GetSpecificPublicKey(curve CurveSystem, index *big.Int, threshold int, pubCommitG2 [][]Point) Point {
  numParticipants := len(pubCommitG2)
  prvCommits := make([]Point, numParticipants)
  for i := 0; i < numParticipants; i++ {
	prvCommits[i] = CalculatePrivateCommitment(curve, index, pubCommitG2[i])
  }
  return AggregatePoints(prvCommits)
}

//GetAllPublicKey returns all participants' public keys
//pubCommitG2 is the public commitments of all praticipants (composed of (t+1)*n points)!
func GetAllPublicKey(curve CurveSystem, threshold int, pubCommitG2 [][]Point) []Point {
  numParticipants := len(pubCommitG2)
  PKs := make([]Point, numParticipants)
  j := big.NewInt(1)
  for i := 0; i < numParticipants; i++ {
	PKs[i] = GetSpecificPublicKey(curve, j, threshold, pubCommitG2)
	j.Add(j, big.NewInt(1))
  }
  return PKs
}

//SignatureReconstruction reconstructs the group signature out of t+1 verified signatures
//signersIndices[i] should be the index of the signer the signed sigs[i]
//e.g., if we have 3 signatures (sigs=[0x..,0x..,0x..]) signed by 5,1 and 2 respectivly
//then signersIndices=[5,1,2]
func SignatureReconstruction(curve CurveSystem, sigs []Point, signersIndices []*big.Int) (Point, error) {
  t1 := len(sigs)
  if t1 < 2 || t1 != len(signersIndices) {
	return nil, fmt.Errorf("input length error")
  }

  delta := make([]*big.Int, t1)
  q := curve.GetG1Order()
  a := big.NewInt(1)
  for i := 0; i < t1; i++ {
	a.Mul(a, signersIndices[i]) // TODO: check no overflow here
  }
  if t1%2 == 0 {
	a.Mul(a, big.NewInt(-1))
  }

  tmp := big.NewInt(0)
  for i := 0; i < t1; i++ {
	b := big.NewInt(0).Set(signersIndices[i])

	for j := 0; j < t1; j++ {
	  if j != i {
		tmp.Sub(signersIndices[i], signersIndices[j]) // TODO: check no overflow here
		if tmp == big.NewInt(0) {
		  return nil, fmt.Errorf("there are 2 signersIndices that are the same")
		}
		b.Mul(b, tmp)
	  }
	}
	delta[i], _ = big.NewInt(0).DivMod(a, b, big.NewInt(0).Set(q))
  }
  sigsExp := make([]Point, t1)
  for i := 0; i < t1; i++ {
	sigsExp[i] = sigs[i].Mul(delta[i])
  }

  return AggregatePoints(sigsExp), nil
}
