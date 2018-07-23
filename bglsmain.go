package main

import (
  "flag"
  "fmt"
  . "github.com/Project-Arda/bgls/curves"
  "math/big"
  "strconv"
  "strings"
  "encoding/json"
  "github.com/orbs-network/bls-bn-curve/bglswrapper"
  "github.com/Project-Arda/bgls/bgls"
  "os"
  "io/ioutil"
  "bufio"
)

// Usage examples:
// ./dkgmain -func=cgen

var cmd string

const INTERACTIVE = true

type DataForCommit struct {
  CoefficientsAll [][]*big.Int
  PubCommitG1All  [][]Point
  PubCommitG2All  [][]Point
  PrvCommitAll    [][]*big.Int
}

type JsonDataForCommit struct {
  CoefficientsAll [][]string
  PubCommitG1All  [][][]string
  PubCommitG2All  [][][]string
  PrvCommitAll    [][]string
}

// Conversions between array of numbers and G1/G2 points:
//func (g1Point *altbn128Point1) ToAffineCoords() []*big.Int
// func (g1Point *altbn128Point2) ToAffineCoords() []*big.Int
// func (curve *altbn128) MakeG2Point(coords []*big.Int, check bool) (Point, bool)

func GetCommitDataForAllParticipantsWithIntentionalErrors(curve CurveSystem, threshold int, n int, complainerIndex int, maliciousIndex int) (*DataForCommit, error) {

  data, _ := GetCommitDataForAllParticipants(curve, threshold, n)
  data = taintData(data, complainerIndex, maliciousIndex)

  return data, nil
}

func taintData(data *DataForCommit, complainerIndex int, maliciousIndex int) *DataForCommit {
  fmt.Printf("Original value (before taint): %x\n", data.PrvCommitAll[maliciousIndex][complainerIndex])
  data.PrvCommitAll[maliciousIndex][complainerIndex].Add(data.PrvCommitAll[maliciousIndex][complainerIndex], big.NewInt(1))
  fmt.Printf("Tainted value %x\n", data.PrvCommitAll[maliciousIndex][complainerIndex])
  fmt.Println()
  return data
}

// Data for commitment:
// Generate t+1 random coefficients from (mod p) field for the polynomial
// Generate public commitments
// Generate private commitments

func GetCommitDataForAllParticipants(curve CurveSystem, t int, n int) (*DataForCommit, error) {

  fmt.Printf("GetCommitDataForAllParticipants() called with t=%v n=%v\n", n, t)

  allData := new(DataForCommit)
  allData.CoefficientsAll = make([][]*big.Int, n)
  allData.PubCommitG1All = make([][]Point, n)
  allData.PubCommitG2All = make([][]Point, n)
  allData.PrvCommitAll = make([][]*big.Int, n)

  //coefsAll := make([][]*big.Int, n)
  //commitG1All := make([][]Point, n)
  //commitG2All := make([][]Point, n)
  //commitPrvAll := make([][]*big.Int, n) // private commit of participant to all
  // Generate coefficients and public commitments for each participant
  for participant := 0; participant < n; participant++ {

	coefs := make([]*big.Int, t+1)
	commitG1 := make([]Point, t+1)
	commitG2 := make([]Point, t+1)
	commitPrv := make([]*big.Int, n)
	for i := 0; i < t+1; i++ {
	  var err error
	  coefs[i], commitG1[i], commitG2[i], err = bglswrapper.CoefficientGen(curve)
	  if err != nil {
		return allData, err
	  }
	  verifyResult := bglswrapper.VerifyPublicCommitment(curve, commitG1[i], commitG2[i])
	  if !verifyResult {
		return nil, fmt.Errorf("VerifyPublicCommitment() failed for (participant=%v i=%v)", participant, i)
	  }
	  fmt.Printf("PASSED VerifyPublicCommitment() (p=%v i=%v)\n", participant, i)
	}

	j := big.NewInt(1)
	for i := 0; i < n; i++ {
	  commitPrv[i] = bglswrapper.GetPrivateCommitment(curve, j, coefs)

	  // FIXME WEIRD!!!

	  //prv := commitPrv[i]
	  //pub := commitG1[i]
	  //_, err := VerifyPrivateCommitment(curve, j, prv, pub)
	  //if err != nil {
	  //  return nil, err
	  //}
	  j.Add(j, big.NewInt(1))
	}
	allData.CoefficientsAll[participant] = coefs
	allData.PubCommitG1All[participant] = commitG1
	allData.PubCommitG2All[participant] = commitG2
	allData.PrvCommitAll[participant] = commitPrv
  }

  return allData, nil
}

// This is for the Complaint flow only - don't call it for now
func VerifyPrivateCommitment(curve CurveSystem, threshold int, n int, data *DataForCommit) (bool, error) {

  // == Verify phase ==

  j := big.NewInt(1)
  for participant := 0; participant < n; participant++ {
	for commitParticipant := 0; commitParticipant < n; commitParticipant++ {
	  prv := data.PrvCommitAll[commitParticipant][participant]
	  pub := data.PubCommitG1All[commitParticipant]
	  if res := bglswrapper.VerifyPrivateCommitment(curve, j, prv, pub); !res {
		return false, fmt.Errorf("private commit doesn't match public commit")
	  }
	}
	j.Add(j, big.NewInt(1))
  }

  return true, nil

}

func SignAndVerify(curve CurveSystem, threshold int, n int, data *DataForCommit) (bool, error) {

  // == Calculate SK, Pks and group PK ==
  // TODO Should be happen only once, after DKG flow is done, and not for every SignAndVerify()

  fmt.Println()
  fmt.Printf("Starting SignAndVerify with threshold=%v n=%v\n", threshold, n)

  fmt.Println("Calculating SK, PK and Commitments - this is done just once, before signing & verifying messages.")

  skAll := make([]*big.Int, n)
  pkAll := make([][]Point, n)
  pubCommitG2Zero := make([]Point, n)
  for participant := 0; participant < n; participant++ {
	pkAll[participant] = bglswrapper.GetAllPublicKey(curve, threshold, data.PubCommitG2All)
	pubCommitG2Zero[participant] = data.PubCommitG2All[participant][0]
	prvCommit := make([]*big.Int, n)
	for commitParticipant := 0; commitParticipant < n; commitParticipant++ {
	  prvCommit[commitParticipant] = data.PrvCommitAll[commitParticipant][participant]
	}
	skAll[participant] = bglswrapper.GetSecretKey(prvCommit)
  }

  fmt.Println("Completed one-time calculation of SK, PK and Commitments")
  fmt.Println("** SECRET KEYS [DEBUG ONLY] **")
  for _, sk := range skAll {
	fmt.Printf("** SK: %x\n", sk)
  }
  fmt.Println()

  //pkOk := true

  ////Verify pkAll are the same for all
  //for participant := 0; participant < n; participant++ {
  //pks := pkAll[participant]
  //for otherParticipant := 0; otherParticipant < n; otherParticipant++ {
  //  if pks[participant] != pkAll[otherParticipant][participant] {
  //	pkOk = false
  //	fmt.Println("pk for the same participant is different among other participants")
  //  }
  //}
  //}
  //
  //if !pkOk {
  //return false, fmt.Errorf("failed PK verification")
  //}
  //

  fmt.Println("Public Key shares - same values are calculated by each client")
  fmt.Println()
  for i, pkShare := range pkAll[0] {
	fmt.Printf("PK share [%v]: %v\n", i, pointToHexCoords(pkShare))
  }

  groupPk := bglswrapper.GetGroupPublicKey(curve, pubCommitG2Zero)

  fmt.Printf("Group PK: %v\n", pointToHexCoords(groupPk))

  //Verify the secret key matches the public key

  //coefsZero := make([]*big.Int, n)
  //for participant := 0; participant < n; participant++ {
  //coefsZero[participant] = data.CoefficientsAll[participant][0]
  //}

  //groupSk := bglswrapper.GetPrivateCommitment(curve, big.NewInt(1), coefsZero)
  //if groupPk != bgls.LoadPublicKey(curve, groupSk) {
  //return false, fmt.Errorf("groupPK doesnt match to groupSK")
  //}

  // == Sign and reconstruct ==

  //d := make([]byte, 64)
  var msg string
  if INTERACTIVE {
	msg = readFromStdin("*** Enter message: ")
  } else {
	msg = "Hello Orbs"
  }

  fmt.Println()
  fmt.Printf("Message for signature verification: %v\n", msg)
  msgBytes := []byte(msg)
  fmt.Printf("Message bytes: %v\n", msgBytes);
  sigs := make([]Point, n)

  // For each participant, generate signature with its SK
  for participant := 0; participant < n; participant++ {
	sigs[participant] = bgls.Sign(curve, skAll[participant], msgBytes)

	if !bgls.VerifySingleSignature(curve, sigs[participant], pkAll[0][participant], msgBytes) {
	  return false, fmt.Errorf("signature invalid")
	}
	fmt.Printf("PASSED VerifySingleSignature() sig share for client ID #%v: %v\n", participant+1, pointToHexCoords(sigs[participant]))
  }

  // Generates indices [0..n)
  indices := make([]*big.Int, n)
  index := big.NewInt(0)
  for participant := 0; participant < n; participant++ {
	index.Add(index, big.NewInt(1))
	indices[participant] = big.NewInt(0).Set(index)
  }

  // These are 1-based (not 0-based)
  subIndices := [][]int{
	//{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15},
	//{1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16},
	//{1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 20, 18, 16, 14},
	{3, 4, 5},
	{2, 4, 5},
	{1, 3, 5},
  }

  for i := 0; i < len(subIndices); i++ {
	fmt.Println()
    fmt.Printf("=====> verifySigOnSubset() subIndices #%v <=====\n", subIndices[i])
    readFromStdin("")
    _, err := verifySigOnSubset(curve, indices, sigs, groupPk, msgBytes, subIndices[i])
	if err != nil {
	  fmt.Printf("Error in subgroup %v: %v", subIndices[i], err)
	  return false, err
	}
	fmt.Printf("PASSED verifySigOnSubset() subIndices #%v\n", subIndices[i])
	fmt.Printf("Verify signature completed successfully for subgroup %v\n", subIndices[i])
	fmt.Println("======================================================")
  }

  fmt.Println()

  return true, nil
}

func verifySigOnSubset(curve CurveSystem, indices []*big.Int, sigs []Point, groupPk Point, msgBytes []byte, subIndices []int) (bool, error) {

  subSigs := make([]Point, len(subIndices))
  subIndicesBigInt := make([]*big.Int, len(subIndices))

  for i, idx := range subIndices {
	subSigs[i] = sigs[idx-1]
	subIndicesBigInt[i] = big.NewInt(int64(idx))
	//subIndices[i] = indices[idx]
  }

  fmt.Printf("Sending to SignatureReconstruction(): indices=%v\n", subIndices)
  //for i, subSig := range subSigs {
  //fmt.Printf("Signature Share %v: %v\n", subIndicesBigInt[i], pointToHexCoords(subSig))
  //}
  groupSig1, err := bglswrapper.SignatureReconstruction(
	curve, subSigs, subIndicesBigInt)
  if err != nil {
	return false, fmt.Errorf("group signature reconstruction failed")
  }

  fmt.Printf("* Created group signature: %v *\n", pointToHexCoords(groupSig1))

  if !bgls.VerifySingleSignature(curve, groupSig1, groupPk, msgBytes) {
	return false, fmt.Errorf("group signature invalid")
  }
  fmt.Printf("* PASSED VerifySingleSignature for subgroup signature: %v\n", pointToHexCoords(groupSig1))
  fmt.Printf("Group PK: %v\n", pointToHexCoords(groupPk))

  return true, nil
}

func pointToHexCoords(p Point) string {

  coords := p.ToAffineCoords()
  res := make([]string, len(coords))
  for i, coord := range coords {
	res[i] = toHexBigInt(coord)
  }
  return fmt.Sprintf("%v", res)
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

  case "VerifyPrivateCommitment":
	// func VerifyPrivateCommitment(curve CurveSystem, myIndex *big.Int, prvCommit *big.Int, pubCommitG1 []Point) bool {
	myIndex, _ := strconv.Atoi(flag.Args()[0])        // 2   1-based
	prvCommitIndex, _ := strconv.Atoi(flag.Args()[1]) // 1   1-based
	dataFile := flag.Arg(2)
	data, err := readDataFile(dataFile, curve)
	if err != nil {
	  fmt.Println("Error in VerifyPrivateCommitment():", err)
	  return
	}

	pubCommitG1 := data.PubCommitG1All[prvCommitIndex-1]
	prvCommit := data.PrvCommitAll[prvCommitIndex-1][myIndex-1]
	// prvCommit is prvCommitAll[0][1] - this is what client 0 has commited to client 1
	// pubCommitG1 [0] - this is all of client 0 public commitments over G1
	boolRes := bglswrapper.VerifyPrivateCommitment(curve, big.NewInt(int64(myIndex)), prvCommit, pubCommitG1)
	fmt.Printf("%v\n", boolToStr(boolRes))

  case "GetCommitDataForAllParticipants":
	fmt.Println("--- GetCommitDataForAllParticipants ---")
	threshold := toInt(flag.Arg(0))
	n := toInt(flag.Arg(1))
	exportDataFile := flag.Arg(2)

	commitData, err := GetCommitDataForAllParticipants(curve, threshold, n)
	if err != nil {
	  fmt.Println("Error in GetCommitDataForallParticipants():", err)
	}
	json, err := marshal(commitData)
	if err != nil {
	  fmt.Println("Error marshalling commit data", err)
	}
	os.Stdout.Write(json)
	err = ioutil.WriteFile(exportDataFile, json, 0644)
	if err != nil {
	  panic(err)
	}
	//err = writeGob("./data.gob", commitData)
	if err != nil {
	  panic(err)
	}

  case "GetCommitDataForAllParticipantsWithIntentionalErrors":
	fmt.Println("--- GetCommitDataForAllParticipantsWithIntentionalErrors ---")
	threshold := toInt(flag.Arg(0))
	n := toInt(flag.Arg(1))
	complainerIndex := toInt(flag.Arg(2))
	maliciousIndex := toInt(flag.Arg(3))
	exportDataFile := flag.Arg(4)

	commitData, err := GetCommitDataForAllParticipantsWithIntentionalErrors(curve, threshold, n, complainerIndex, maliciousIndex)
	if err != nil {
	  fmt.Println("Error in GetCommitDataForAllParticipantsWithIntentionalErrors():", err)
	}
	json, err := marshal(commitData)
	if err != nil {
	  fmt.Println("Error marshalling commit data", err)
	}
	os.Stdout.Write(json)
	err = ioutil.WriteFile(exportDataFile, json, 0644)
	if err != nil {
	  panic(err)
	}
	//err = writeGob("./data.gob", commitData)
	if err != nil {
	  panic(err)
	}

  case "SignAndVerify":
	fmt.Println("--- SignAndVerify ---")
	threshold := toInt(flag.Arg(0))
	n := toInt(flag.Arg(1))
	dataFile := flag.Arg(2)
	data, err := readDataFile(dataFile, curve)
	isOk, err := SignAndVerify(curve, threshold, n, data)
	if err != nil {
	  fmt.Println("Error in SignAndVerify():", err)
	  return
	}
	fmt.Printf("SignAndVerify() ok? %v\n", isOk)

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

func readDataFile(dataFile string, curve CurveSystem) (*DataForCommit, error) {
  var inBuf []byte
  var err error
  inBuf, err = ioutil.ReadFile(dataFile)
  //err = readGob("./data.gob", data)
  if err != nil {
	panic(err)
  }
  return unmarshal(curve, inBuf)
}
func unmarshal(curve CurveSystem, bytes []byte) (*DataForCommit, error) {

  //fmt.Println("Start unmarshal")
  jsonData := new(JsonDataForCommit)
  if err := json.Unmarshal(bytes, jsonData); err != nil {
	return nil, err
  }
  n := len(jsonData.CoefficientsAll)
  commitData := new(DataForCommit)
  commitData.CoefficientsAll = make([][]*big.Int, n)
  commitData.PubCommitG1All = make([][]Point, n)
  commitData.PubCommitG2All = make([][]Point, n)
  commitData.PrvCommitAll = make([][]*big.Int, n)

  for i := 0; i < len(jsonData.CoefficientsAll); i++ {
	commitData.CoefficientsAll[i] = make([]*big.Int, len(jsonData.CoefficientsAll[i]))
	for j := 0; j < len(jsonData.CoefficientsAll[i]); j++ {
	  commitData.CoefficientsAll[i][j] = toBigInt(jsonData.CoefficientsAll[i][j])
	}
  }

  for i := 0; i < len(jsonData.PubCommitG1All); i++ {
	commitData.PubCommitG1All[i] = make([]Point, len(jsonData.PubCommitG1All[i]))
	for j := 0; j < len(jsonData.PubCommitG1All[i]); j++ {

	  coords := make([]*big.Int, len(jsonData.PubCommitG1All[i][j]))
	  for k := 0; k < len(jsonData.PubCommitG1All[i][j]); k++ {
		coords[k] = toBigInt(jsonData.PubCommitG1All[i][j][k])
	  }
	  var isOk bool
	  commitData.PubCommitG1All[i][j], isOk = curve.MakeG1Point(coords, true)
	  if !isOk {
		panic(fmt.Errorf("Failed to make G1 point"))
	  }
	}
  }

  for i := 0; i < len(jsonData.PubCommitG2All); i++ {
	commitData.PubCommitG2All[i] = make([]Point, len(jsonData.PubCommitG2All[i]))
	for j := 0; j < len(jsonData.PubCommitG2All[i]); j++ {

	  coords := make([]*big.Int, len(jsonData.PubCommitG2All[i][j]))
	  for k := 0; k < len(jsonData.PubCommitG2All[i][j]); k++ {
		coords[k] = toBigInt(jsonData.PubCommitG2All[i][j][k])
	  }
	  var isOk bool
	  commitData.PubCommitG2All[i][j], isOk = curve.MakeG2Point(coords, true)
	  if !isOk {
		panic(fmt.Errorf("Failed to make G2 point"))
		fmt.Println("G2 Point: ", commitData.PubCommitG2All[i][j])
	  }
	}
  }

  for i := 0; i < len(jsonData.PrvCommitAll); i++ {
	commitData.PrvCommitAll[i] = make([]*big.Int, len(jsonData.PrvCommitAll[i]))
	for j := 0; j < len(jsonData.PrvCommitAll[i]); j++ {
	  commitData.PrvCommitAll[i][j] = toBigInt(jsonData.PrvCommitAll[i][j])
	}
  }

  //fmt.Println("End unmarshal")
  return commitData, nil

}

func marshal(commitData *DataForCommit) ([]byte, error) {

  n := len(commitData.CoefficientsAll)
  jsonData := new(JsonDataForCommit)
  jsonData.CoefficientsAll = make([][]string, n)
  jsonData.PubCommitG1All = make([][][]string, n)
  jsonData.PubCommitG2All = make([][][]string, n)
  jsonData.PrvCommitAll = make([][]string, n)

  for i := 0; i < len(commitData.CoefficientsAll); i++ {
	jsonData.CoefficientsAll[i] = make([]string, len(commitData.CoefficientsAll[i]))
	for j := 0; j < len(commitData.CoefficientsAll[i]); j++ {
	  jsonData.CoefficientsAll[i][j] = toHexBigInt(commitData.CoefficientsAll[i][j])
	}
  }

  for i := 0; i < len(commitData.PubCommitG1All); i++ {
	jsonData.PubCommitG1All[i] = make([][]string, len(commitData.PubCommitG1All[i]))
	for j := 0; j < len(commitData.PubCommitG1All[i]); j++ {
	  coords := commitData.PubCommitG1All[i][j].ToAffineCoords()
	  coordsStr := make([]string, len(coords))
	  for k := 0; k < len(coords); k++ {
		coordsStr[k] = toHexBigInt(coords[k])
	  }
	  jsonData.PubCommitG1All[i][j] = coordsStr
	}
  }

  for i := 0; i < len(commitData.PubCommitG2All); i++ {
	jsonData.PubCommitG2All[i] = make([][]string, len(commitData.PubCommitG2All[i]))
	for j := 0; j < len(commitData.PubCommitG2All[i]); j++ {
	  coords := commitData.PubCommitG2All[i][j].ToAffineCoords()
	  coordsStr := make([]string, len(coords))
	  for k := 0; k < len(coords); k++ {
		coordsStr[k] = toHexBigInt(coords[k])
	  }
	  jsonData.PubCommitG2All[i][j] = coordsStr
	}
  }

  for i := 0; i < len(commitData.PrvCommitAll); i++ {
	jsonData.PrvCommitAll[i] = make([]string, len(commitData.PrvCommitAll[i]))
	for j := 0; j < len(commitData.PrvCommitAll[i]); j++ {
	  jsonData.PrvCommitAll[i][j] = toHexBigInt(commitData.PrvCommitAll[i][j])
	}
  }

  return json.MarshalIndent(jsonData, "", "  ")

}
func toHexBigInt(n *big.Int) string {
  return fmt.Sprintf("0x%x", n) // or %X or upper case
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
  bigInt, ok := bigInt.SetString(s, 0)
  if !ok {
	panic(fmt.Errorf("toBigInt() failed on string %v", s))
  }
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

  //fmt.Println("-- BGLSMAIN.GO -- ")

}

func readFromStdin(caption string) (string) {
  reader := bufio.NewReader(os.Stdin)
  fmt.Println()
  fmt.Print(caption)
  text, _ := reader.ReadString('\n')
  return text
}
