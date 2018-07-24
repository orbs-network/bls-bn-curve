package main

import (
  "flag"
  "fmt"
  "math/big"
  "strconv"
  "strings"
  "encoding/json"
  "github.com/orbs-network/bgls/dkg"
  "github.com/orbs-network/bgls/bgls"
  . "github.com/orbs-network/bgls/curves"
  "os"
  "io/ioutil"
  "bufio"
)

// Usage examples:
// ./dkgmain -func=cgen

var cmd string

const INTERACTIVE = true
const BigintAsStrBase = 16 // All bigints as strings are in hex

type KeyPair struct {
  SK string `json:"sk"`
  PK []string `json:"pk"`
}


type AllDataForCommit struct {
  CoefficientsAll [][]*big.Int
  PubCommitG1All  [][]Point
  PubCommitG2All  [][]Point
  PrvCommitAll    [][]*big.Int
}

type DataForCommit struct {
  Coefficients []*big.Int
  PubCommitG1  []Point
  PubCommitG2  []Point
  PrvCommit    []*big.Int
}

type JsonAllDataForCommit struct {
  CoefficientsAll [][]string
  PubCommitG1All  [][][]string
  PubCommitG2All  [][][]string
  PrvCommitAll    [][]string
}

// Conversions between array of numbers and G1/G2 points:
//func (g1Point *altbn128Point1) ToAffineCoords() []*big.Int
// func (g1Point *altbn128Point2) ToAffineCoords() []*big.Int
// func (curve *altbn128) MakeG2Point(coords []*big.Int, check bool) (Point, bool)

// Data for commitment:
// Generate t+1 random coefficients from (mod p) field for the polynomial
// Generate public commitments
// Generate private commitments

// index is 1-based
func GetCommitDataForSingleParticipant(curve CurveSystem, index int, t int, n int, mySK *big.Int, pks []Point) (*DataForCommit, error) {
  data := DataForCommit{
	Coefficients: make([]*big.Int, t+1),
	PubCommitG1:  make([]Point, t+1),
	PubCommitG2:  make([]Point, t+1),
	PrvCommit:    make([]*big.Int, n),
  }

  for i := 0; i < t+1; i++ {
	var err error
	data.Coefficients[i], data.PubCommitG1[i], data.PubCommitG2[i], err = dkg.CoefficientGen(curve)
	if err != nil {
	  return nil, err
	}
	verifyResult := dkg.VerifyPublicCommitment(curve, data.PubCommitG1[i], data.PubCommitG2[i])
	if !verifyResult {
	  return nil, fmt.Errorf("VerifyPublicCommitment() failed for (participant=%v i=%v)", index, i)
	}
	//fmt.Printf("PASSED VerifyPublicCommitment() (index=%v i=%v)\n", index, i)
  }

  j := big.NewInt(1)
  for i := 0; i < n; i++ {
	if i == index-1 {
	  data.PrvCommit[i] = big.NewInt(0) // Don't calculate private commitment from me to myself
	} else {
	  plainPrvCommit := dkg.GetPrivateCommitment(curve, j, data.Coefficients)
	  //fmt.Printf("Calling Encrypt() with sk=%v pks[%v]=%v\n", mySK, i, pks[i].ToAffineCoords(), )
	  data.PrvCommit[i] = dkg.Encrypt(curve, mySK, pks[i], plainPrvCommit)
	  //fmt.Printf("Encrypt() result: %v\n", data.PrvCommit[i])
	}
	j.Add(j, big.NewInt(1))
  }

  return &data, nil
}

/*
func GetCommitDataForAllParticipants(curve CurveSystem, t int, n int) (*AllDataForCommit, error) {

  fmt.Printf("GetCommitDataForAllParticipants() called with t=%v n=%v\n", n, t)

  allData := new(AllDataForCommit)
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
	  coefs[i], commitG1[i], commitG2[i], err = dkg.CoefficientGen(curve)
	  if err != nil {
		return allData, err
	  }
	  verifyResult := dkg.VerifyPublicCommitment(curve, commitG1[i], commitG2[i])
	  if !verifyResult {
		return nil, fmt.Errorf("VerifyPublicCommitment() failed for (participant=%v i=%v)", participant, i)
	  }
	  fmt.Printf("PASSED VerifyPublicCommitment() (p=%v i=%v)\n", participant, i)
	}

	j := big.NewInt(1)
	for i := 0; i < n; i++ {
	  if i == participant {
		commitPrv[i] = big.NewInt(0) // Don't calculate private commitment from me to myself
	  } else {
		plainPrvCommit := dkg.GetPrivateCommitment(curve, j, coefs)
		commitPrv[i] = dkg.Encrypt(curve, SK, PK, plainPrvCommit)
	  }


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
*/

/*
func GetCommitDataForAllParticipantsWithIntentionalErrors(curve CurveSystem, threshold int, n int, complainerIndex int, maliciousIndex int) (*AllDataForCommit, error) {

  data, _ := GetCommitDataForAllParticipants(curve, threshold, n)
  data = taintData(data, complainerIndex, maliciousIndex)

  return data, nil
}


func taintData(data *AllDataForCommit, complainerIndex int, maliciousIndex int) *AllDataForCommit {
  fmt.Printf("Original value (before taint): %x\n", data.PrvCommitAll[maliciousIndex][complainerIndex])
  data.PrvCommitAll[maliciousIndex][complainerIndex].Add(data.PrvCommitAll[maliciousIndex][complainerIndex], big.NewInt(1))
  fmt.Printf("Tainted value %x\n", data.PrvCommitAll[maliciousIndex][complainerIndex])
  fmt.Println()
  return data
}

*/

// This is for the Complaint flow only - don't call it for now
//func VerifyPrivateCommitment(curve CurveSystem, threshold int, n int, data *AllDataForCommit) (bool, error) {
//
//  // == Verify phase ==
//
//  j := big.NewInt(1)
//  for participant := 0; participant < n; participant++ {
//	for commitParticipant := 0; commitParticipant < n; commitParticipant++ {
//	  prv := data.PrvCommitAll[commitParticipant][participant]
//	  pub := data.PubCommitG1All[commitParticipant]
//	  if res := dkg.VerifyPrivateCommitment(curve, j, prv, pub); !res {
//		return false, fmt.Errorf("private commit doesn't match public commit")
//	  }
//	}
//	j.Add(j, big.NewInt(1))
//  }
//
//  return true, nil
//
//}

func SignAndVerify(curve CurveSystem, threshold int, n int, data *AllDataForCommit) (bool, error) {

  // == Calculate SK, Pks and group PK ==
  // Should be happen only once, after DKG flow is done, and not for every SignAndVerify()

  fmt.Println()
  fmt.Printf("Starting SignAndVerify with threshold=%v n=%v\n", threshold, n)

  fmt.Println("Calculating SK, PK and Commitments - this is done just once, before signing & verifying messages.")

  skAll := make([]*big.Int, n)
  pkAll := make([][]Point, n)
  pubCommitG2Zero := make([]Point, n)
  for participant := 0; participant < n; participant++ {
	pkAll[participant] = dkg.GetAllPublicKey(curve, threshold, data.PubCommitG2All)
	pubCommitG2Zero[participant] = data.PubCommitG2All[participant][0]
	prvCommit := make([]*big.Int, n)
	for commitParticipant := 0; commitParticipant < n; commitParticipant++ {
	  prvCommit[commitParticipant] = data.PrvCommitAll[commitParticipant][participant]
	}
	skAll[participant] = dkg.GetSecretKey(prvCommit)
  }

  fmt.Println("Completed one-time calculation of SK, PK and Commitments")
  fmt.Println("** SECRET KEYS [DEBUG ONLY] **")
  for _, sk := range skAll {
	fmt.Printf("** SK: %x\n", sk)
  }
  fmt.Println()

  fmt.Println("Public Key shares - same values are calculated by each client")
  fmt.Println()
  for i, pkShare := range pkAll[0] {
	fmt.Printf("PK share [%v]: %v\n", i, pointToHexCoords(pkShare))
  }

  groupPk := dkg.GetGroupPublicKey(curve, pubCommitG2Zero)

  fmt.Printf("Group PK: %v\n", pointToHexCoords(groupPk))

  // == Sign and reconstruct ==

  var msg string
  if INTERACTIVE {
	msg = readFromStdin("*** Enter message: ")
  } else {
	msg = "Hello Orbs"
  }

  fmt.Println()
  fmt.Printf("Message for signature verification: %v\n", msg)
  msgBytes := []byte(msg)
  fmt.Printf("Message bytes: %v\n", msgBytes)
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
  groupSig1, err := dkg.SignatureReconstruction(
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
	myIndex, _ := strconv.Atoi(flag.Args()[0])                           // 2   1-based
	prvCommit, _ := new(big.Int).SetString(flag.Arg(1), 0)
	pubCommitG1 := strToG1s(curve, flag.Arg(2))
	// prvCommit is prvCommitAll[0][1] - this is what client 0 has commited to client 1
	// pubCommitG1 [0] - this is all of client 0 public commitments over G1
	boolRes := dkg.VerifyPrivateCommitment(curve, big.NewInt(int64(myIndex)), prvCommit, pubCommitG1)
	res := fmt.Sprintf("%v\n", boolToStr(boolRes))
	fmt.Println(res)

  case "GetCommitDataForSingleParticipant":
	myIndex, _ := strconv.Atoi(flag.Args()[0])
	threshold := toInt(flag.Arg(1))
	n := toInt(flag.Arg(2))
	sk, _ := new(big.Int).SetString(flag.Arg(3), 0)
	pks := strToG1s(curve, flag.Arg(4))

	dataForCommit, err := GetCommitDataForSingleParticipant(curve, myIndex, threshold, n, sk, pks)
	if err != nil {
	  panic(err)
	}

	// TODO Add marshalling for point - maybe add new type like in JsonAllDataForCommit

    json, err := json.Marshal(dataForCommit)
    if err != nil {
	  fmt.Println("Error: ", err)
    }
    fmt.Printf("%v\n", string(json))

	/*
			case "VerifyPrivateCommitment__":
				// func VerifyPrivateCommitment(curve CurveSystem, myIndex *big.Int, prvCommit *big.Int, pubCommitG1 []Point) bool {
				myIndex, _ := strconv.Atoi(flag.Args()[0])        // 2   1-based
				prvCommitIndex, _ := strconv.Atoi(flag.Args()[1]) // 1   1-based
				dataFile := flag.Arg(2)
				data, err := readDataFile(dataFile, curve)
				if err != nil {
				fmt.Println("Error in VerifyPrivateCommitment():", err)
				}

				pubCommitG1 := data.PubCommitG1All[prvCommitIndex-1]
				prvCommit := data.PrvCommitAll[prvCommitIndex-1][myIndex-1]
				// prvCommit is prvCommitAll[0][1] - this is what client 0 has commited to client 1
				// pubCommitG1 [0] - this is all of client 0 public commitments over G1
				boolRes := dkg.VerifyPrivateCommitment(curve, big.NewInt(int64(myIndex)), prvCommit, pubCommitG1)
				res := fmt.Sprintf("%v\n", boolToStr(boolRes))
				fmt.Println(res)
		*/
	/*
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
		*/
  case "SignAndVerify":
	fmt.Println("--- SignAndVerify ---")
	threshold := toInt(flag.Arg(0))
	n := toInt(flag.Arg(1))
	dataFile := flag.Arg(2)
	data, err := readDataFile(dataFile, curve)
	isOk, err := SignAndVerify(curve, threshold, n, data)
	if err != nil {
	  res := fmt.Sprintf("Error in SignAndVerify(): %v", err)
	  fmt.Println(res)
	}
	fmt.Printf("SignAndVerify() ok? %v\n", isOk)

  case "GenerateKeyPair":
	sk, pk, _, _ := dkg.CoefficientGen(curve)
    keyPair := KeyPair{bigIntToHexStr(sk), pointToStrArray(pk)}
    //keyPairJson, _ := keyPair.Marshal()
    //fmt.Println(keyPair)
    json, err := json.Marshal(keyPair)
    if err != nil {
      fmt.Println("Error: ", err)
    }
    fmt.Printf("%v\n", string(json))

	/*
	case "LoadPublicKeyG1":
	// func LoadPublicKeyG1(curve CurveSystem, SK *big.Int) Point {
	SK := toBigInt(flag.Args()[0])
	point := dkg.LoadPublicKeyG1(curve, SK)
	fmt.Printf("%v\n", pointToStr(point))
	case "GetPrivateCommitment":
	// func GetPrivateCommitment(curve CurveSystem, ind *big.Int, coefficients []*big.Int) *big.Int {
	ind := toBigInt(flag.Args()[0])
	coefficients := toBigInts(flag.Args()[1:])
	bigInt := dkg.GetPrivateCommitment(curve, ind, coefficients)
	fmt.Printf("%v\n", bigIntToHexStr(bigInt))
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
	fmt.Printf("%v\n", bigIntToHexStr(bigInt))
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

// Gets array of the form p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], etc.
// Each pair is a G1 point so an array of Points is returned.
// This is not
func strToG1s(curve CurveSystem, pointStr string) []Point {
  pointStrCoords := strings.Split(pointStr, ",")
  points := make([]Point, len(pointStrCoords)/2)
  for i := 0; i < len(pointStrCoords); i += 2 {
	//fmt.Printf("Reading pointsStrCoords i=%v of %v", i, len(pointStrCoords))
    coord0, ok := new(big.Int).SetString(pointStrCoords[i], 0)
	if !ok {
	  panic(fmt.Errorf("failed parsing coord0 to big.Int: %v (big.Int value: %v)", pointStrCoords[i], coord0))
	}
	coord1, ok := new(big.Int).SetString(pointStrCoords[i+1], 0)
    if !ok {
      panic(fmt.Errorf("failed parsing coord1 to big.Int: %v (big.Int value: %v)", pointStrCoords[i], coord1))
    }

    bigintCoords := []*big.Int{coord0, coord1}
	//fmt.Printf("strToG1: coord0=%v coord1=%v\n", coord0, coord1)
    point, _ := curve.MakeG1Point(bigintCoords, true)
	points[i/2] = point
  }
  return points
}

func strToG1(curve CurveSystem, pointStr string) Point {
  pointStrCoords := strings.Split(pointStr, ",")
  bigintCoords := make([]*big.Int, len(pointStrCoords))
  for i := 0; i < len(pointStr); i++ {
	bigintCoords[i], _ = new(big.Int).SetString(pointStrCoords[i], 0)
  }
  point, _ := curve.MakeG1Point(bigintCoords, true)
  return point
}

func readDataFile(dataFile string, curve CurveSystem) (*AllDataForCommit, error) {
  var inBuf []byte
  var err error
  inBuf, err = ioutil.ReadFile(dataFile)
  //err = readGob("./data.gob", data)
  if err != nil {
	panic(err)
  }
  return unmarshal(curve, inBuf)
}


func unmarshal(curve CurveSystem, bytes []byte) (*AllDataForCommit, error) {

  //fmt.Println("Start unmarshal")
  jsonData := new(JsonAllDataForCommit)
  if err := json.Unmarshal(bytes, jsonData); err != nil {
	return nil, err
  }
  n := len(jsonData.CoefficientsAll)
  commitData := new(AllDataForCommit)
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

func (keyPair KeyPair) Marshal() ([]byte, error) {

  //type KeyPairJson struct {
  //  SK string,
  //  PK []string
  //}
  //
  //keyPairJson := new KeyPairJson()
  //keyPairJson.SK = bigIntToHexStr(keyPair.SK)
  //keyPairJson(.PK = pointToStrArray(keyPair.PK)}

  return json.Marshal(keyPair)
}

func marshal(commitData *AllDataForCommit) ([]byte, error) {

  n := len(commitData.CoefficientsAll)
  jsonData := new(JsonAllDataForCommit)
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
	  coordsStr := pointToStrArray(commitData.PubCommitG1All[i][j])
	  jsonData.PubCommitG1All[i][j] = coordsStr
	}
  }

  for i := 0; i < len(commitData.PubCommitG2All); i++ {
	jsonData.PubCommitG2All[i] = make([][]string, len(commitData.PubCommitG2All[i]))
	for j := 0; j < len(commitData.PubCommitG2All[i]); j++ {
	  coordsStr := pointToStrArray(commitData.PubCommitG2All[i][j])
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
func pointToStrArray(point Point) []string {
  coords := point.ToAffineCoords()
  coordsStr := make([]string, len(coords))
  for k := 0; k < len(coords); k++ {
	coordsStr[k] = toHexBigInt(coords[k])
  }
  return coordsStr

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

func bigIntToHexStr(bigInt *big.Int) string {
  return fmt.Sprintf("0x%x", bigInt)
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
