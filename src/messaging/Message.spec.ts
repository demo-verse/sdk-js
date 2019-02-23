import Identity from '../identity/Identity'
import {
  IRequestClaimsForCtype,
  default as Message,
  MessageBodyType,
  IEncryptedMessage,
  IMessage,
  IRequestAttestationForClaim,
  ISubmitAttestationForClaim,
  ISubmitClaimsForCtype,
} from './Message'
import { EncryptedAsymmetricString } from '../crypto/Crypto'
import Crypto from '../crypto'

describe('Messaging', () => {
  const identityAlice = Identity.buildFromSeedString('Alice')
  const identityBob = Identity.buildFromSeedString('Bob')

  it('verify message encryption and signing', () => {
    const messageBody: IRequestClaimsForCtype = {
      content: '0x12345678',
      type: MessageBodyType.REQUEST_CLAIMS_FOR_CTYPE,
    }
    const message: Message = new Message(
      messageBody,
      identityAlice,
      identityBob.getPublicIdentity()
    )
    const encryptedMessage: IEncryptedMessage = message.getEncryptedMessage()

    const decryptedMessage: IMessage = Message.createFromEncryptedMessage(
      encryptedMessage,
      identityAlice.getPublicIdentity(),
      identityBob
    )
    expect(JSON.stringify(messageBody)).toEqual(
      JSON.stringify(decryptedMessage.body)
    )

    const encryptedMessageWrongHash: IEncryptedMessage = JSON.parse(
      JSON.stringify(encryptedMessage)
    ) as IEncryptedMessage
    encryptedMessageWrongHash.hash = '0x00000000'
    expect(() =>
      Message.createFromEncryptedMessage(
        encryptedMessageWrongHash,
        identityAlice.getPublicIdentity(),
        identityBob
      )
    ).toThrowError(new Error('Hash of message not correct'))

    const encryptedMessageWrongSignature: IEncryptedMessage = JSON.parse(
      JSON.stringify(encryptedMessage)
    ) as IEncryptedMessage
    encryptedMessageWrongSignature.signature =
      encryptedMessageWrongSignature.signature.substr(
        0,
        encryptedMessageWrongSignature.signature.length - 4
      ) + '1234'
    expect(() =>
      Message.createFromEncryptedMessage(
        encryptedMessageWrongSignature,
        identityAlice.getPublicIdentity(),
        identityBob
      )
    ).toThrowError(new Error('Signature of message not correct'))

    const encryptedMessageWrongContent: IEncryptedMessage = JSON.parse(
      JSON.stringify(encryptedMessage)
    ) as IEncryptedMessage
    encryptedMessageWrongContent.message = '1234'
    const hashStrWrongContent: string = Crypto.hashStr(
      encryptedMessageWrongContent.message +
        encryptedMessageWrongContent.nonce +
        encryptedMessageWrongContent.createdAt
    )
    encryptedMessageWrongContent.hash = hashStrWrongContent
    ;(encryptedMessageWrongContent.signature = identityAlice.signStr(
      hashStrWrongContent
    )),
      expect(() =>
        Message.createFromEncryptedMessage(
          encryptedMessageWrongContent,
          identityAlice.getPublicIdentity(),
          identityBob
        )
      ).toThrowError(new Error('Error decoding message'))

    const encryptedWrongBody: EncryptedAsymmetricString = identityAlice.encryptAsymmetricAsStr(
      '{ wrong JSON',
      identityBob.boxPublicKeyAsHex
    )
    const ts: number = Date.now()
    const hashStrBadContent: string = Crypto.hashStr(
      encryptedWrongBody.box + encryptedWrongBody.nonce + ts
    )
    const encryptedMessageWrongBody: IEncryptedMessage = {
      createdAt: ts,
      receiverAddress: encryptedMessage.receiverAddress,
      senderAddress: encryptedMessage.senderAddress,
      message: encryptedWrongBody.box,
      nonce: encryptedWrongBody.nonce,
      hash: hashStrBadContent,
      signature: identityAlice.signStr(hashStrBadContent),
    } as IEncryptedMessage
    expect(() =>
      Message.createFromEncryptedMessage(
        encryptedMessageWrongBody,
        identityAlice.getPublicIdentity(),
        identityBob
      )
    ).toThrowError(new Error('Error parsing message body'))
  })

  it('verify message sender is owner', () => {
    const requestAttestationBody: IRequestAttestationForClaim = {
      content: {
        ctypeHash: { nonce: '0x12345678', hash: '0x12345678' },
        claim: {
          cType: '0x12345678',
          owner: identityAlice.getPublicIdentity().address,
          contents: {},
        },
        claimHashTree: {},
        legitimations: [],
        hash: '0x12345678',
        claimerSignature: '0x12345678',
      },
      type: MessageBodyType.REQUEST_ATTESTATION_FOR_CLAIM,
    }

    Message.ensureOwnerIsSender(
      new Message(
        requestAttestationBody,
        identityAlice,
        identityBob.getPublicIdentity()
      )
    )
    expect(() =>
      Message.ensureOwnerIsSender(
        new Message(
          requestAttestationBody,
          identityBob,
          identityAlice.getPublicIdentity()
        )
      )
    ).toThrowError(new Error('Sender is not owner of the claim'))

    const submitAttestationBody: ISubmitAttestationForClaim = {
      content: {
        request: requestAttestationBody.content,
        attestation: {
          claimHash: requestAttestationBody.content.hash,
          signature: '0x12345678',
          owner: identityBob.getPublicIdentity().address,
          revoked: false,
        },
      },
      type: MessageBodyType.SUBMIT_ATTESTATION_FOR_CLAIM,
    }
    expect(() =>
      Message.ensureOwnerIsSender(
        new Message(
          submitAttestationBody,
          identityAlice,
          identityBob.getPublicIdentity()
        )
      )
    ).toThrowError(new Error('Sender is not owner of the attestation'))
    Message.ensureOwnerIsSender(
      new Message(
        submitAttestationBody,
        identityBob,
        identityAlice.getPublicIdentity()
      )
    )

    const submitClaimsForCTypeBody: ISubmitClaimsForCtype = {
      content: [ submitAttestationBody.content ],
      type: MessageBodyType.SUBMIT_CLAIMS_FOR_CTYPE,
    }

    Message.ensureOwnerIsSender(
      new Message(
          submitClaimsForCTypeBody,
        identityAlice,
        identityBob.getPublicIdentity()
      )
    )
    expect(() =>
      Message.ensureOwnerIsSender(
        new Message(
            submitClaimsForCTypeBody,
          identityBob,
          identityAlice.getPublicIdentity()
        )
      )
    ).toThrowError(new Error('Sender is not owner of the claims'))
  })
})
