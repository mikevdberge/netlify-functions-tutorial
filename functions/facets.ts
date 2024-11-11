import { UnicodeString } from './unicode'
import { HandlerEvent } from '@netlify/functions'
import TLDs from 'tlds'
import { AppBskyRichtextFacet } from '@atproto/api'
import { processFacets } from './facetProcessor.js';

type Facet = AppBskyRichtextFacet.Main

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const handler = async (event: HandlerEvent) => {
//exports.handler = async (event, context) => {

    if (!event.body || event.httpMethod !== 'POST') {
      console.log("Invalid request body: ",event.body);
      console.log("Invald HTTP Method:", event.httpMethod);
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({
          status: 'invalid-method'
        })
      }
    }
    
      const data = JSON.parse(event.body)
    
      if (!data.text) {
        console.error('Required information is missing.')
        console.log("Invalid request body: ",event.body);
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type'
          },
          body: JSON.stringify({
            status: 'missing-information'
          })
        }
      }

    unicodeText: UnicodeString
    const body = JSON.parse(event.body)
    console.log("Received body",JSON.stringify(body))
    //get BlueSky facets (JSON) from the provided text
    unicodeText = new UnicodeString(body.text)
    let facet = detectFacets(unicodeText);

    //let facet = processFacets(body.text);
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
          },
        body: JSON.stringify({facet}),
    }
}

class UnicodeString {
  utf16: string
  utf8: Uint8Array

  constructor(utf16: string) {
    this.utf16 = utf16
    this.utf8 = encoder.encode(utf16)
  }

  // helper to convert utf16 code-unit offsets to utf8 code-unit offsets
  utf16IndexToUtf8Index(i: number) {
    return encoder.encode(this.utf16.slice(0, i)).byteLength
  }
}

function detectFacets(text: UnicodeString): Facet[] | undefined {
  let match
  const facets: Facet[] = []
  
  console.log("message",text)
  
  {
    // mentions
    const re = /(^|\s|\()(@)([a-zA-Z0-9.-]+)(\b)/g
    while ((match = re.exec(text.utf16))) {
      if (!isValidDomain(match[3]) && !match[3].endsWith('.test')) {
        continue // probably not a handle
      }

      const start = text.utf16.indexOf(match[3], match.index) - 1
      facets.push({
        $type: 'app.bsky.richtext.facet',
        index: {
          byteStart: text.utf16IndexToUtf8Index(start),
          byteEnd: text.utf16IndexToUtf8Index(start + match[3].length + 1),
        },
        features: [
          {
            $type: 'app.bsky.richtext.facet#mention',
            did: match[3], // must be resolved afterwards
          },
        ],
      })
    }
  }
  {
    // links
    const re =
      /(^|\s|\()((https?:\/\/[\S]+)|((?<domain>[a-z][a-z0-9]*(\.[a-z0-9]+)+)[\S]*))/gim
    console.log("utf16 message",text.utf16)
    while ((match = re.exec(text.utf16))) {
      let uri = match[2]
      console.log("In matching while loop")
      if (!uri.startsWith('http')) {
        const domain = match.groups?.domain
        if (!domain || !isValidDomain(domain)) {
          continue
        }
        uri = `https://${uri}`
      }
      const start = text.utf16.indexOf(match[2], match.index)
      const index = { start, end: start + match[2].length }
      // strip ending puncuation
      if (/[.,;!?]$/.test(uri)) {
        uri = uri.slice(0, -1)
        index.end--
      }
      if (/[)]$/.test(uri) && !uri.includes('(')) {
        uri = uri.slice(0, -1)
        index.end--
      }
      facets.push({
        index: {
          byteStart: text.utf16IndexToUtf8Index(index.start),
          byteEnd: text.utf16IndexToUtf8Index(index.end),
        },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri,
          },
        ],
      })
    }
  }
  {
    const re = /(?:^|\s)(#[^\d\s]\S*)(?=\s)?/g
    while ((match = re.exec(text.utf16))) {
      let [tag] = match
      const hasLeadingSpace = /^\s/.test(tag)

      tag = tag.trim().replace(/\p{P}+$/gu, '') // strip ending punctuation

      // inclusive of #, max of 64 chars
      if (tag.length > 66) continue

      const index = match.index + (hasLeadingSpace ? 1 : 0)

      facets.push({
        index: {
          byteStart: text.utf16IndexToUtf8Index(index),
          byteEnd: text.utf16IndexToUtf8Index(index + tag.length), // inclusive of last char
        },
        features: [
          {
            $type: 'app.bsky.richtext.facet#tag',
            tag: tag.replace(/^#/, ''),
          },
        ],
      })
    }
  }
  return facets.length > 0 ? facets : undefined
}

function isValidDomain(str: string): boolean {
  return !!TLDs.find((tld) => {
    const i = str.lastIndexOf(tld)
    if (i === -1) {
      return false
    }
    return str.charAt(i - 1) === '.' && i === str.length - tld.length
  })
}