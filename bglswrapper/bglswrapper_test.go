package bglswrapper

import (
  "crypto/rand"
  "math/big"
  "testing"

  . "github.com/Project-Arda/bgls/curves"
  "github.com/stretchr/testify/assert"
  "github.com/Project-Arda/bgls/bgls"
)

var threshold = 2
var n = 5

func TestDKGHappyFlow(t *testing.T) {
  //for _, curve := range curves {

  curve := Altbn128

  // == Commit phase ==

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
	  coefs[i], commitG1[i], commitG2[i], err = CoefficientGen(curve)
	  assert.Nil(t, err, "test data generation failed")
	  assert.True(t, VerifyPublicCommitment(curve, commitG1[i], commitG2[i]), "commit G1 and G2 fail")
	}

	j := big.NewInt(1)
	for i := 0; i < n; i++ {
	  commitPrv[i] = GetPrivateCommitment(curve, j, coefs)
	  j.Add(j, big.NewInt(1))
	}
	coefsAll[participant] = coefs
	commitG1All[participant] = commitG1
	commitG2All[participant] = commitG2
	commitPrvAll[participant] = commitPrv
  }

  // == Verify phase ==
  j := big.NewInt(1)
  for participant := 0; participant < n; participant++ {
	for commitParticipant := 0; commitParticipant < n; commitParticipant++ {
	  prv := commitPrvAll[commitParticipant][participant]
	  pub := commitG1All[commitParticipant]
	  assert.True(t, VerifyPrivateCommitment(curve, j, prv, pub), "private commit doesnt match public commit")
	}
	j.Add(j, big.NewInt(1))
  }

  // == Calculate SK, Pks and group PK ==
  skAll := make([]*big.Int, n)
  pkAll := make([][]Point, n)
  pubCommitG2Zero := make([]Point, n)
  for participant := 0; participant < n; participant++ {
	pkAll[participant] = GetAllPublicKey(curve, threshold, commitG2All)
	pubCommitG2Zero[participant] = commitG2All[participant][0]
	prvCommit := make([]*big.Int, n)
	for commitParticipant := 0; commitParticipant < n; commitParticipant++ {
	  prvCommit[commitParticipant] = commitPrvAll[commitParticipant][participant]
	}
	skAll[participant] = GetSecretKey(prvCommit)
  }

  //Verify pkAll are the same for all
  for participant := 0; participant < n; participant++ {
	pks := pkAll[participant]
	for otherParticipant := 0; otherParticipant < n; otherParticipant++ {
	  assert.True(t, pks[participant].Equals(pkAll[otherParticipant][participant]),
		"pk for the same participant is different among other paricipants")
	}
  }

  groupPk := GetGroupPublicKey(curve, pubCommitG2Zero)
  //Verify the secret key matches the public key
  coefsZero := make([]*big.Int, n)
  for participant := 0; participant < n; participant++ {
	coefsZero[participant] = coefsAll[participant][0]
  }
  groupSk := GetPrivateCommitment(curve, big.NewInt(1), coefsZero)
  assert.True(t, groupPk.Equals(bgls.LoadPublicKey(curve, groupSk)),
	"groupPK doesnt match to groupSK")

  // == Sign and reconstruct ==
  d := make([]byte, 64)
  var err error
  _, err = rand.Read(d)
  assert.Nil(t, err, "msg data generation failed")
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

  groupSig1, err := SignatureReconstruction(
	curve, sigs[:threshold+1], indices[:threshold+1])
  assert.Nil(t, err, "group signature reconstruction fail")
  assert.True(t, bgls.VerifySingleSignature(curve, groupSig1, groupPk, d),
	"group signature invalid")

  groupSig2, err := SignatureReconstruction(
	curve, sigs[n-(threshold+1):], indices[n-(threshold+1):])
  assert.Nil(t, err, "group signature reconstruction fail")
  assert.True(t, bgls.VerifySingleSignature(curve, groupSig2, groupPk, d),
	"group signature invalid")
  assert.True(t, groupSig1.Equals(groupSig2), "group signatures are not equal")
  //}
}

/*
func TestNothing(t *testing.T) {
  for _, curve := range curves {
	x := big.NewInt(123456789)
	g2Commit := LoadPublicKeyG2(curve, x)
	g1Commit := LoadPublicKeyG1(curve, x)
	d1g := g1Commit.ToAffineCoords()
	d2g := g2Commit.ToAffineCoords()
	d1g0 := d1g[0].Text(10)
	_ = d1g0
	d1g1 := d1g[1].Text(10)
	_ = d1g1
	d2g0 := d2g[0].String()
	_ = d2g0
	d2g1 := d2g[1].String()
	_ = d2g1
	d2g2 := d2g[2].String()
	_ = d2g2
	d2g3 := d2g[3].String()
	_ = d2g3

	pnt, _ := curve.MakeG1Point(d1g, true)
	_ = pnt

	assert.True(t, VerifyPublicCommitment(curve, g1Commit, g2Commit), "commit G1 and G2 fail")
  }
}

*/
