import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { marked } from 'marked';
import { prepare, layout } from '@chenglou/pretext';
import { Printer } from 'lucide-react';

import dummyText from './assets/dummy.md?raw';

// A4 dimensions and layout specs
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const PADDING = 75;
const CONTENT_WIDTH = PAGE_WIDTH - (PADDING * 2);
const CONTENT_HEIGHT = PAGE_HEIGHT - (PADDING * 2) - 40; // minus space for page number

const FONT_FAMILY = '"Pretendard Variable", sans-serif';

// Strip basic inline markdown for rough measurement
function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') // bold
    .replace(/\*(.*?)\*/g, '$1') // italic
    .replace(/__(.*?)__/g, '$1') // bold
    .replace(/_(.*?)_/g, '$1') // italic
    .replace(/~~(.*?)~~/g, '$1') // strikethrough
    .replace(/==(.*?)==/g, '$1') // highlight
    .replace(/`(.*?)`/g, '$1') // code
    .replace(/<mark>(.*?)<\/mark>/g, '$1'); // html mark
}

// Measure block height using pretext
function measureBlock(token) {
  let height = 0;
  const type = token.type;
  
  if (type === 'heading') {
    const text = stripMarkdown(token.text);
    if (token.depth === 1) {
      const font = `800 32px ${FONT_FAMILY}`;
      const textH = layout(prepare(text, font), CONTENT_WIDTH, 32 * 1.6).height;
      height = textH + 24;
    } else if (token.depth === 2) {
      const font = `700 24px ${FONT_FAMILY}`;
      const textH = layout(prepare(text, font), CONTENT_WIDTH, 24 * 1.6).height;
      height = 32 + textH + 16 + 9;
    } else if (token.depth === 3) {
      const font = `700 20px ${FONT_FAMILY}`;
      const textH = layout(prepare(text, font), CONTENT_WIDTH, 20 * 1.6).height;
      height = 24 + textH + 12;
    } else if (token.depth === 4) {
      const font = `600 18px ${FONT_FAMILY}`;
      const textH = layout(prepare(text, font), CONTENT_WIDTH, 18 * 1.6).height;
      height = 20 + textH + 10;
    } else {
      const font = `600 15px ${FONT_FAMILY}`;
      const textH = layout(prepare(text, font), CONTENT_WIDTH, 15 * 1.6).height;
      height = 16 + textH + 8;
    }
  } else if (type === 'paragraph' || type === 'text') {
    const text = stripMarkdown(token.text || token.raw);
    const font = `400 15px ${FONT_FAMILY}`;
    const textH = layout(prepare(text, font, { wordBreak: 'keep-all' }), CONTENT_WIDTH, 15 * 1.7).height;
    height = textH + 16;
  } else if (type === 'list') {
    let listHeight = 0;
    for (const item of token.items) {
      // recursively measure items, but manually subtract width for list padding
      const itemHeight = measureBlock({ ...item, type: 'paragraph' });
      listHeight += itemHeight; 
    }
    height = listHeight + 16;
  } else if (type === 'blockquote') {
    let innerHeight = 0;
    if (token.tokens) {
      for (const child of token.tokens) {
        innerHeight += measureBlock(child);
      }
    } else {
      const text = stripMarkdown(token.text);
      const font = `400 15px ${FONT_FAMILY}`;
      innerHeight = layout(prepare(text, font, { wordBreak: 'keep-all' }), CONTENT_WIDTH - 36, 15 * 1.7).height + 16;
    }
    height = 24 + innerHeight; // padding top/bottom
  } else if (type === 'space') {
    height = 0;
  } else {
    if (token.tokens) {
      for (const child of token.tokens) {
        height += measureBlock(child);
      }
    } else {
      const text = stripMarkdown(token.raw);
      const font = `400 15px ${FONT_FAMILY}`;
      height = layout(prepare(text, font), CONTENT_WIDTH, 15 * 1.7).height + 16;
    }
  }
  
  return height;
}

// Convert markdown highlighted ==text== to <mark>text</mark>
// Since ReactMarkdown uses remark-gfm but doesn't do ==highlight==, we pre-process it
const preprocessMarkdown = (md) => {
  return md.replace(/==(.*?)==/g, '<mark>$1</mark>');
};

function App() {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isPrintMode, setIsPrintMode] = useState(false);

  useEffect(() => {
    // Wait for the custom font to load before calculating layout
    document.fonts.ready.then(() => {
      const rawText = dummyText;
      const preprocessed = preprocessMarkdown(rawText);
      const tokens = marked.lexer(preprocessed);
      
      const newPages = [];
      let currentPageTokens = [];
      let currentHeight = 0;

      for (const token of tokens) {
        const tokenHeight = measureBlock(token);
        const isQuestionHeading = token.type === 'heading' && token.depth === 3;
        
        if ((currentHeight + tokenHeight > CONTENT_HEIGHT || isQuestionHeading) && currentPageTokens.length > 0) {
          // If we hit a new question (###) or the page is full, push to new page
          // Avoid creating empty pages if previous tokens were just spaces.
          const hasContent = currentPageTokens.some(t => t.type !== 'space');
          
          if (hasContent) {
            newPages.push(currentPageTokens);
            currentPageTokens = [token];
            currentHeight = tokenHeight;
          } else {
            currentPageTokens.push(token);
            currentHeight += tokenHeight;
          }
        } else {
          currentPageTokens.push(token);
          currentHeight += tokenHeight;
        }
      }

      if (currentPageTokens.length > 0) {
        newPages.push(currentPageTokens);
      }

      setPages(newPages);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="loading">노트 레이아웃 계산 중...</div>;
  }

  return (
    <div className="app-container">
      <div className="controls">
        <h1>IELTS Study Note</h1>
        <div className="button-group">
          <button 
            className={`toggle-btn ${!isPrintMode ? 'active' : ''}`} 
            onClick={() => setIsPrintMode(false)}
          >
            웹에서 보기
          </button>
          <button 
            className={`toggle-btn ${isPrintMode ? 'active' : ''}`} 
            onClick={() => setIsPrintMode(true)}
          >
            A4 인쇄용
          </button>
          <button 
            className="print-button" 
            onClick={() => {
              setIsPrintMode(true);
              setTimeout(() => window.print(), 100);
            }}
          >
            <Printer size={18} />
            인쇄 / PDF
          </button>
        </div>
      </div>

      {!isPrintMode ? (
        <div className="web-container">
          <div className="markdown-content">
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {preprocessMarkdown(dummyText)}
            </ReactMarkdown>
          </div>
        </div>
      ) : (
        <div className="pages-container">
          {pages.map((pageTokens, index) => {
            // Reconstruct markdown from tokens for this page
            const pageMarkdown = pageTokens.map(t => t.raw).join('');
            return (
              <div className="page" key={index}>
                <div className="page-content">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                  >
                    {pageMarkdown}
                  </ReactMarkdown>
                </div>
                <div className="page-number">- {index + 1} -</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default App;
