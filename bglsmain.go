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
  "math/rand"
  "github.com/Project-Arda/bgls/bgls"
  "os"
  "io/ioutil"
)

// Usage examples:
// ./dkgmain -func=cgen

var cmd string

const POINT_ELEMENTS = 4
const BIGINT_BASE = 10

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

//func (data *DataForCommit) MarshalJSON() ([]byte, error) {
//
//}

// Conversions between array of numbers and G1/G2 points:
//func (g1Point *altbn128Point1) ToAffineCoords() []*big.Int
// func (g1Point *altbn128Point2) ToAffineCoords() []*big.Int
// func (curve *altbn128) MakeG2Point(coords []*big.Int, check bool) (Point, bool)

func getPubCommitG1() {

}
func getPubCommitG2() {

}
func getPrCommit() {

}

func GetCommitDataForAllParticipants(curve CurveSystem, n int, threshold int) (*DataForCommit, error) {

  fmt.Printf("GetCommitDataForAllParticipants() called with n=%v threshold=%v\n", n, threshold)


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

	coefs := make([]*big.Int, threshold+1)
	commitG1 := make([]Point, threshold+1)
	commitG2 := make([]Point, threshold+1)
	commitPrv := make([]*big.Int, n)
	for i := 0; i < threshold+1; i++ {
	  var err error
	  coefs[i], commitG1[i], commitG2[i], err = bglswrapper.CoefficientGen(curve)
	  if err != nil {
		return allData, err
	  }
	  verifyResult := bglswrapper.VerifyPublicCommitment(curve, commitG1[i], commitG2[i])
	  fmt.Printf("VerifyPublicCommitment() (p=%v i=%v) passed? %v\n", participant, i, verifyResult)
	}

	j := big.NewInt(1)
	for i := 0; i < n; i++ {
	  commitPrv[i] = bglswrapper.GetPrivateCommitment(curve, j, coefs)
	  j.Add(j, big.NewInt(1))
	}
	allData.CoefficientsAll[participant] = coefs
	allData.PubCommitG1All[participant] = commitG1
	allData.PubCommitG2All[participant] = commitG2
	allData.PrvCommitAll[participant] = commitPrv
  }

  return allData, nil
}

func SignAndVerify(curve CurveSystem, n int, threshold int, data *DataForCommit) (bool, error) {
  // == Verify phase ==

  //coefsAll := data.CoefficientsAll
  //commitG1All := data.PubCommitG1All
  //commitG2All := data.PubCommitG2All
  //commitPrvAll := data.PrvCommitAll

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

  // == Calculate SK, Pks and group PK ==
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

  groupPk := bglswrapper.GetGroupPublicKey(curve, pubCommitG2Zero)
  //Verify the secret key matches the public key
  coefsZero := make([]*big.Int, n)
  for participant := 0; participant < n; participant++ {
	coefsZero[participant] = data.CoefficientsAll[participant][0]
  }
  groupSk := bglswrapper.GetPrivateCommitment(curve, big.NewInt(1), coefsZero)
  if groupPk != bgls.LoadPublicKey(curve, groupSk) {
	return false, fmt.Errorf("groupPK doesnt match to groupSK")
  }

  // == Sign and reconstruct ==
  d := make([]byte, 64)
  var err error
  _, err = rand.Read(d)
  //assert.Nil(t, err, "msg data generation failed")
  sigs := make([]Point, n)
  for participant := 0; participant < n; participant++ {
	sigs[participant] = bgls.Sign(curve, skAll[participant], d)
	if !bgls.VerifySingleSignature(curve, sigs[participant], pkAll[0][participant], d) {
	  return false, fmt.Errorf("signature invalid")
	}
  }

  indices := make([]*big.Int, n)
  index := big.NewInt(0)
  for participant := 0; participant < n; participant++ {
	index.Add(index, big.NewInt(1))
	indices[participant] = big.NewInt(0).Set(index)
  }

  groupSig1, err := bglswrapper.SignatureReconstruction(
	curve, sigs[:threshold+1], indices[:threshold+1])
  if err != nil {
	return false, fmt.Errorf("group signature reconstruction fail")
  }
  if !bgls.VerifySingleSignature(curve, groupSig1, groupPk, d) {
	return false, fmt.Errorf("group signature invalid")
  }

  groupSig2, err := bglswrapper.SignatureReconstruction(
	curve, sigs[n-(threshold+1):], indices[n-(threshold+1):])

  if err != nil {
	return false, fmt.Errorf("group signature reconstruction fail")
  }
  if !bgls.VerifySingleSignature(curve, groupSig2, groupPk, d) {
	return false, fmt.Errorf("group signatures are not equal")
  }

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
	dataFile := flag.Arg(2)

	commitData, err := GetCommitDataForAllParticipants(curve, n, threshold)
	if err != nil {
	  fmt.Println("Error in GetCommitDataForallParticipants():", err)
	}
	//json, err := jsoniter.Marshal(commitData)
	json, err := marshal(commitData)
	if err != nil {
	  fmt.Println("Error marshalling commit data", err)
	}
	fmt.Println()
	os.Stdout.Write(json)
	err = ioutil.WriteFile(dataFile, json, 0644)
	if err != nil {
	  panic(err)
	}
	fmt.Println()

  case "SignAndVerify":
	n := toInt(flag.Arg(0))
	threshold := toInt(flag.Arg(1))
	dataFile := flag.Arg(2)
	inBuf, err := ioutil.ReadFile(dataFile)
	//jsonStr := flag.Arg(2)
	var data DataForCommit
	fmt.Printf("\ninBuf=%v\n\n", string(inBuf))
	err = json.Unmarshal(inBuf, &data)
	if err != nil {
	  panic(err)
	}
	isOk, err := SignAndVerify(curve, n, threshold, &data)
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
func marshal(commitData *DataForCommit) ([]byte, error) {

  n := len(commitData.CoefficientsAll)
  jsonData := new(JsonDataForCommit)
  jsonData.CoefficientsAll = make([][]string, n)
  jsonData.PubCommitG1All = make([][][]string, n)
  jsonData.PubCommitG2All = make([][][]string, n)
  jsonData.PrvCommitAll = make([][]string, n)


  for i:=0; i<len(commitData.CoefficientsAll); i++	{
	jsonData.CoefficientsAll[i] = make([]string, len(commitData.CoefficientsAll[i]))
    for j:=0; j<len(commitData.CoefficientsAll[i]); j++ {
	  jsonData.CoefficientsAll[i][j] = commitData.CoefficientsAll[i][j].String()
	}
  }



  for i:=0; i<len(commitData.PubCommitG1All); i++	{
	jsonData.PubCommitG1All[i] = make([][]string, len(commitData.PubCommitG1All[i]))
	for j:=0; j<len(commitData.PubCommitG1All[i]); j++ {
	  coords := commitData.PubCommitG1All[i][j].ToAffineCoords()
	  coordsStr := make([]string, len(coords))
	  for k:=0; k<len(coords); k++ {
	    coordsStr[k] = coords[k].String()
	  }
	  jsonData.PubCommitG1All[i][j] = coordsStr
	}
  }
  for i:=0; i<len(commitData.PubCommitG2All); i++	{
	jsonData.PubCommitG2All[i] = make([][]string, len(commitData.PubCommitG2All[i]))
    for j:=0; j<len(commitData.PubCommitG2All[i]); j++ {
	  coords := commitData.PubCommitG2All[i][j].ToAffineCoords()
	  coordsStr := make([]string, len(coords))
	  for k:=0; k<len(coords); k++ {
		coordsStr[k] = coords[k].String()
	  }
	  jsonData.PubCommitG2All[i][j] = coordsStr
	}
  }
  for i:=0; i<len(commitData.PrvCommitAll); i++	{
	jsonData.PrvCommitAll[i] = make([]string, len(commitData.PrvCommitAll[i]))
	for j:=0; j<len(commitData.PrvCommitAll[i]); j++ {
	  jsonData.PrvCommitAll[i][j] = commitData.PrvCommitAll[i][j].String()
	}
  }

  return json.MarshalIndent(jsonData, "", "  ")

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

  fmt.Println("-- BGLSMAIN.GO -- ")

}
