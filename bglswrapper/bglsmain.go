package main

import (
  "flag"
  "fmt"
  . "github.com/Project-Arda/bgls/curves"
  "math/big"
  "strconv"
  "strings"
  "encoding/json"
  "github.com/orbs-network/bls-bn-curve/bglswrapper/bgls"
  "github.com/stretchr/testify/assert"
  "math"
)

// Usage examples:
// ./dkgmain -func=cgen

var cmd string

const POINT_ELEMENTS = 4
const BIGINT_BASE = 10

type DataForCommit struct {
  coefficients []*big.Int
  pubCommitG1  []Point
  pubCommitG2  []Point
  prvCommit    []*big.Int
}

// Conversions between array of numbers and G1/G2 points:
// func (g1Point *altbn128Point1) ToAffineCoords() []*big.Int
// func (g1Point *altbn128Point2) ToAffineCoords() []*big.Int
// func (curve *altbn128) MakeG2Point(coords []*big.Int, check bool) (Point, bool)

func getPubCommitG1() {

}
func getPubCommitG2() {

}
func getPrCommit() {

}

func GetCommitDataForAllParticipants(curve CurveSystem, n int, threshold int) (map[string]interface{}, error) {
  coefsAll := make([][]*big.Int, n)
  commitG1All := make([][]Point, n)
  commitG2All := make([][]Point, n)
  commitPrvAll := make([][]*big.Int, n) // private commit of participant to all
  // Generate coefficients and public commitments for each participant
  for participant := 0; participant < n; participant++ {

	coefs := make([]*big.Int, threshold+1)
	commitG1 := make([]Point, threshold+1)
	commitG2 := make([]Point, threshold+1)
	commitPrv := make([]*big.Int, n)
	for i := 0; i < threshold+1; i++ {
	  var err error
	  coefs[i], commitG1[i], commitG2[i], err = bgls.CoefficientGen(curve)
	  if err != nil {
		return nil, err
	  }
	  verifyResult := bgls.VerifyPublicCommitment(curve, commitG1[i], commitG2[i])
	  fmt.Println("VerifyPublicCommitment() passed? ", verifyResult)
	}

	j := big.NewInt(1)
	for i := 0; i < n; i++ {
	  commitPrv[i] = bgls.GetPrivateCommitment(curve, j, coefs)
	  j.Add(j, big.NewInt(1))
	}
	coefsAll[participant] = coefs
	commitG1All[participant] = commitG1
	commitG2All[participant] = commitG2
	commitPrvAll[participant] = commitPrv
  }

  return map[string]interface{}{"coefficients": coefsAll, "pubCommitG1": commitG1All, "pubCommitG2": commitG2All, "prvCommit": commitPrvAll}, nil
}

func SignAndVerify(curve CurveSystem, n int, threshold int, data map[string]interface{}) (bool, error) {
  // == Verify phase ==

  coefsAll := data["coefficients"]
  commitG1All := data["pubCommitG1"]
  commitG2All := data["pubCommitG2"]
  commitPrvAll := data["prvCommit"]

  j := big.NewInt(1)
  for participant := 0; participant < n; participant++ {
	for commitParticipant := 0; commitParticipant < n; commitParticipant++ {
	  prv := commitPrvAll[commitParticipant][participant]
	  pub := commitG1All[commitParticipant]
	  if res := bgls.VerifyPrivateCommitment(curve, j, prv, pub); !res {
		return false, fmt.Errorf("private commit doesn't match public commit")
	  }
	}
	j.Add(j, big.NewInt(1))
  }

  // == Calculate SK, Pks and group PK ==
  skAll := make([]*big.Int, n)
  pkAll := make([][]Point, n)
  pubCommitG2Zero := make([]Point, n)
  for participant := 0; participant < n; participant++ {
	pkAll[participant] = bgls.GetAllPublicKey(curve, threshold, commitG2All)
	pubCommitG2Zero[participant] = commitG2All[participant][0]
	prvCommit := make([]*big.Int, n)
	for commitParticipant := 0; commitParticipant < n; commitParticipant++ {
	  prvCommit[commitParticipant] = commitPrvAll[commitParticipant][participant]
	}
	skAll[participant] = bgls.GetSecretKey(prvCommit)
  }

  pkOk := true

  //Verify pkAll are the same for all
  for participant := 0; participant < n; participant++ {
	pks := pkAll[participant]
	for otherParticipant := 0; otherParticipant < n; otherParticipant++ {
	  if pks[participant] != pkAll[otherParticipant][participant] {
		pkOk = false
		fmt.Println("pk for the same participant is different among other participants")
	  }
	}
  }

  if !pkOk {
	return false, fmt.Errorf("failed PK verification")
  }

  groupPk := bgls.GetGroupPublicKey(curve, pubCommitG2Zero)
  //Verify the secret key matches the public key
  coefsZero := make([]*big.Int, n)
  for participant := 0; participant < n; participant++ {
	coefsZero[participant] = coefsAll[participant][0]
  }
  groupSk := bgls.GetPrivateCommitment(curve, big.NewInt(1), coefsZero)
  if groupPk != LoadPublicKey(curve, groupSk) {
	return false, fmt.Errorf("groupPK doesnt match to groupSK")
  }

  // == Sign and reconstruct ==
  d := make([]byte, 64)
  var err error
  _, err = math.rand.Read(d)
  //assert.Nil(t, err, "msg data generation failed")
  sigs := make([]Point, n)
  for participant := 0; participant < n; participant++ {
	sigs[participant] = bgls.Sign(curve, skAll[participant], d)
	assert.True(t, bgls.VerifySingleSignature(curve, sigs[participant], pkAll[0][participant], d),
	  "signature invalid")
  }

  indices := make([]*big.Int, n)
  index := big.NewInt(0)
  for participant := 0; participant < n; participant++ {
	index.Add(index, big.NewInt(1))
	indices[participant] = big.NewInt(0).Set(index)
  }

  groupSig1, err := bgls.SignatureReconstruction(
	curve, sigs[:threshold+1], indices[:threshold+1])
  assert.Nil(t, err, "group signature reconstruction fail")
  assert.True(t, bgls.VerifySingleSignature(curve, groupSig1, groupPk, d),
	"group signature invalid")

  groupSig2, err := bgls.SignatureReconstruction(
	curve, sigs[n-(threshold+1):], indices[n-(threshold+1):])
  assert.Nil(t, err, "group signature reconstruction fail")
  assert.True(t, bgls.VerifySingleSignature(curve, groupSig2, groupPk, d),
	"group signature invalid")
  assert.True(t, groupSig1.Equals(groupSig2), "group signatures are not equal")

  return true, nil

}

// Returns pubCommitG1 (array of 2d points), pubCommitG2 (array of 4d points) and prvCommit (array of bigints)
// This is for
//func GetDataForCommit(curve CurveSystem, threshold int, clientsCount int) map[string]interface{} {
//
//  coefficients := make([]*big.Int, threshold+1)
//  pubCommitG1 := make([]Point, threshold+1)
//  pubCommitG2 := make([]Point, threshold+1)
//  prvCommit := make([]*big.Int, clientsCount)
//
//  for i := 0; i < threshold+1; i++ {
//	coefficients[i], pubCommitG1[i], pubCommitG2[i], _ = CoefficientGen(curve)
//	dkg.VerifyPublicCommitment(curve, pubCommitG1[i], pubCommitG2[i])
//  }
//
//  j := big.NewInt(1)
//  for i := 0; i < clientsCount; i++ {
//	prvCommit[i] = dkg.GetPrivateCommitment(curve, j, coefficients)
//	j.Add(j, big.NewInt(1))
//  }
//
//  return map[string]interface{}{"coefficients": coefficients, "pubCommitG1": pubCommitG1, "pubCommitG2": pubCommitG2, "prvCommit": prvCommit}
//
//  //return json.Marshal(1)
//}

func main() {
  Init()
  curve := Altbn128
  //fmt.Println(cmd)
  //fmt.Println(flag.Args())
  switch cmd {

  case "GetCommitDataForAllParticipants":
	n := toInt(flag.Arg(0))
	threshold := toInt(flag.Arg(1))

	commitData, err := GetCommitDataForAllParticipants(curve, n, threshold)
	if err != nil {
	  fmt.Println("Error in GetCommitDataForallParticipants():", err)
	}
	json, err := json.Marshal(commitData)
	if err != nil {
	  fmt.Println("Error marshalling commit data", err)
	}
	fmt.Printf("%v", string(json))

  case "SignAndVerify":
	n := toInt(flag.Arg(0))
	threshold := toInt(flag.Arg(1))
	data := json.Unmarshal(flag.Arg(2))
	isOk, err := SignAndVerify(curve, n, threshold, data)
	if err != nil {
	  fmt.Println("Error in SignAndVerify():", err)
	  return
	}
	fmt.Printf("%v", isOk)


	/*
	  case "GetDataForCommit":
		threshold := toInt(flag.Args()[0])
		clientCount := toInt(flag.Args()[1])
		res := GetDataForCommit(curve, threshold, clientCount)
		json, err := json.Marshal(res)
		if err != nil {
		  fmt.Println("Error in json:", err)
		}
		//fmt.Printf("%T %v\n", res, res)
		fmt.Printf("%v", string(json))

	  case "CoefficientGen":
		// func CoefficientGen(curve CurveSystem) (*big.Int, Point, Point, error) {
		x, g1commit, g2commit, error := dkg.CoefficientGen(curve)
		fmt.Printf("%v %v %v %v\n", bigIntToStr(x), pointToStr(g1commit), pointToStr(g2commit), error)
	  case "LoadPublicKeyG1":
		// func LoadPublicKeyG1(curve CurveSystem, sk *big.Int) Point {
		sk := toBigInt(flag.Args()[0])
		point := dkg.LoadPublicKeyG1(curve, sk)
		fmt.Printf("%v\n", pointToStr(point))
	  case "GetPrivateCommitment":
		// func GetPrivateCommitment(curve CurveSystem, ind *big.Int, coefficients []*big.Int) *big.Int {
		ind := toBigInt(flag.Args()[0])
		coefficients := toBigInts(flag.Args()[1:])
		bigInt := dkg.GetPrivateCommitment(curve, ind, coefficients)
		fmt.Printf("%v\n", bigIntToStr(bigInt))
	  case "GetGroupPublicKey":
		// func GetGroupPublicKey(curve CurveSystem, pubCommitG2 []Point) Point {
		pubCommitG2 := toPoints(flag.Args())
		point := dkg.GetGroupPublicKey(curve, pubCommitG2)
		fmt.Printf("%v\n", pointToStr(point))
	  case "VerifyPublicCommitment":
		// func VerifyPublicCommitment(curve CurveSystem, pubCommitG1 Point, pubCommitG2 Point) bool
		pubCommitG1 := toPoint(flag.Args()[0:POINT_ELEMENTS])
		pubCommitG2 := toPoint(flag.Args()[POINT_ELEMENTS : POINT_ELEMENTS+POINT_ELEMENTS])
		boolRes := dkg.VerifyPublicCommitment(curve, pubCommitG1, pubCommitG2)
		fmt.Printf("%v\n", boolToStr(boolRes))
	  case "VerifyPrivateCommitment":
		// func VerifyPrivateCommitment(curve CurveSystem, myIndex *big.Int, prvCommit *big.Int, pubCommitG1 []Point) bool {
		myIndex := toBigInt(flag.Args()[0])
		prvCommit := toBigInt(flag.Args()[1])
		pubCommitG1 := toPoints(flag.Args()[2:])
		boolRes := dkg.VerifyPrivateCommitment(curve, myIndex, prvCommit, pubCommitG1)
		fmt.Printf("%v\n", boolToStr(boolRes))

	  case "CalculatePrivateCommitment":
		// func CalculatePrivateCommitment(curve CurveSystem, index *big.Int, pubCommit []Point) Point {
		index := toBigInt(flag.Args()[0])
		pubCommit := toPoints(flag.Args()[1:])
		point := dkg.CalculatePrivateCommitment(curve, index, pubCommit)
		fmt.Printf("%v\n", pointToStr(point))
	  case "GetSecretKey":
		// func GetSecretKey(prvCommits []*big.Int) *big.Int {
		prvCommits := toBigInts(flag.Args())
		bigInt := dkg.GetSecretKey(prvCommits)
		fmt.Printf("%v\n", bigIntToStr(bigInt))
	  case "GetSpecificPublicKey":
		// func GetSpecificPublicKey(curve CurveSystem, index *big.Int, threshold int, pubCommitG2 []Point) Point {
		index := toBigInt(flag.Args()[0])
		threshold := toInt(flag.Args()[1])
		pubCommitG2 := toPoints(flag.Args()[2:])
		pointRes := dkg.GetSpecificPublicKey(curve, index, threshold, pubCommitG2)
		fmt.Printf("%v\n", pointToStr(pointRes))
	  case "GetAllPublicKey":
		// func GetAllPublicKey(curve CurveSystem, threshold int, pubCommitG2 []Point) []Point {
		threshold := toInt(flag.Args()[0])
		pubCommitG2 := toPoints(flag.Args()[1:])
		pointsRes := dkg.GetAllPublicKey(curve, threshold, pubCommitG2)
		fmt.Printf("%v\n", pointsToStr(pointsRes))
	  case "SignatureReconstruction":
		// func SignatureReconstruction(curve CurveSystem, sigs []Point, signersIndices []*big.Int) (Point, error) {
		// We don't know in advance how many sigs there are so take a param for that,
		// multiply by how many array elements create a single point, then read the points, then read the next param
		sigsLen := toInt(flag.Args()[0])
		sigsElements := sigsLen * POINT_ELEMENTS
		sigs := toPoints(flag.Args()[1:sigsElements])
		signersIndices := toBigInts(flag.Args()[sigsElements:])
		point, err := dkg.SignatureReconstruction(curve, sigs, signersIndices)
		fmt.Printf("%v %v\n", pointToStr(point), err)
	*/
  }

}
func toPoint(strings []string) Point {
  panic("Not implemented")
}

func toInt(s string) int {
  i, _ := strconv.Atoi(s)
  return i
}
func toPoints(args []string) []Point {
  panic("Not implemented")
}

func toBigInts(strings []string) []*big.Int {
  bigInts := make([]*big.Int, len(strings))
  for i := 0; i < len(strings); i++ {
	bigInts[i] = toBigInt(strings[i])
  }
  return bigInts
}

func toBigInt(s string) *big.Int {
  bigInt := new(big.Int)
  bigInt.SetString(s, BIGINT_BASE)
  return bigInt
}

func boolToStr(boolRes bool) string {
  return fmt.Sprintf("%v", boolRes)
}

func bigIntToStr(bigInt *big.Int) string {
  return fmt.Sprintf("%v", bigInt)
}

func pointToStr(point Point) string {
  return fmt.Sprintf("%v", point)
}

func pointsToStr(points []Point) interface{} {
  pointsStr := make([]string, len(points))
  for i := 0; i < len(points); i++ {
	pointsStr[i] = pointToStr(points[i])
  }
  return strings.Join(pointsStr, " ")
}

func Init() {

  flag.StringVar(&cmd, "func", "", "Name of function")
  flag.Parse()

}
