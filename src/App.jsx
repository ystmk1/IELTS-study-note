import { useState, useEffect, useMemo, useRef, useId, useContext, createContext } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { marked } from 'marked';
import { prepare, layout } from '@chenglou/pretext';
import { Printer, ChevronLeft, ChevronRight } from 'lucide-react';

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Split a note's raw markdown into the leading "#tag #tag" line (if present)
// and the rest of the body.
function splitTagsAndBody(rawText) {
  const lines = rawText.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && /^(#[^\s#]+)(\s+#[^\s#]+)*\s*$/.test(lines[i].trim())) {
    return {
      tagLine: lines[i].trim(),
      body: lines.slice(i + 1).join('\n').replace(/^\n+/, ''),
    };
  }
  return { tagLine: '', body: rawText };
}

function extractQuestions(body) {
  const seen = new Map();
  const result = [];
  const re = /^###\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    const text = m[1].trim();
    const base = slugify(text) || 'q';
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;
    result.push({ text, id });
  }
  return result;
}

// Markdown hashtags can't contain spaces, so use `_` in the tag and we
// render it as a space in the UI. e.g. `#집과_건물` → "집과 건물".
function formatTagLabel(tag) {
  return String(tag).replace(/^#/, '').replace(/_/g, ' ');
}

// Load all markdown files from the notes directory
const noteModules = import.meta.glob('./notes/*.md', { query: '?raw', eager: true });
const allNotes = Object.entries(noteModules).map(([path, content]) => {
  const rawText = content.default || content;
  const tagMatches = rawText.match(/#[^\s#]+/g) || [];
  const tags = [...new Set(tagMatches)];
  const { tagLine, body } = splitTagsAndBody(rawText);
  const filename = path.split('/').pop().replace('.md', '');
  // Title for the floating TOC: 3rd tag if available, otherwise filename
  const tagOnlyList = tagLine
    ? tagLine.split(/\s+/).filter(Boolean)
    : tags;
  const title = formatTagLabel(tagOnlyList[2] || filename);
  const questions = extractQuestions(body);

  return {
    id: path,
    title,
    filename,
    rawText,
    body,
    tagLine,
    tags,
    tagList: tagOnlyList,
    questions,
  };
});

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
    .replace(/<mark[^>]*>(.*?)<\/mark>/g, '$1'); // html mark
}

// Pull "수정한 거 설명" blocks out of the markdown. Each list item under
// the block (`- **key**: value`) becomes a key→explanation entry; the
// block itself is stripped from the rendered markdown so it only surfaces
// through highlight tooltips.
function extractExplanations(md) {
  const map = {};
  const lines = md.split('\n');
  const result = [];
  let inBlock = false;
  let currentKey = null;
  let currentValueLines = [];

  const flushCurrentItem = () => {
    if (currentKey !== null) {
      map[currentKey] = currentValueLines.join('\n').trim();
      currentKey = null;
      currentValueLines = [];
    }
  };

  const isBlockHeader = (line) =>
    /^\s*(?:\*\*\s*수정한\s*거?\s*설명\s*\*\*|#{1,6}\s+수정한\s*거?\s*설명)\s*$/.test(line);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isBlockHeader(line)) {
      flushCurrentItem();
      inBlock = true;
      continue;
    }

    if (inBlock) {
      const itemMatch = /^\s*[-*]\s+\*\*(.+?)\*\*\s*[:：]\s*(.*)$/.exec(line);
      if (itemMatch) {
        flushCurrentItem();
        currentKey = itemMatch[1].trim();
        currentValueLines = [itemMatch[2]];
        continue;
      }

      // End of block: a new heading, an hr, or another **bold heading** line
      if (
        /^#{1,6}\s/.test(line) ||
        /^---+\s*$/.test(line) ||
        /^\s*\*\*[^*]+\*\*\s*$/.test(line)
      ) {
        flushCurrentItem();
        inBlock = false;
        result.push(line);
        continue;
      }

      if (currentKey !== null) {
        currentValueLines.push(line);
      }
      continue;
    }

    result.push(line);
  }

  flushCurrentItem();
  return { explanations: map, cleanedMd: result.join('\n') };
}

function htmlAttrEscape(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;');
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

const preprocessMarkdown = (md, { addDividers = true } = {}) => {
  const { explanations, cleanedMd } = extractExplanations(md);
  let processed = cleanedMd.replace(/==(.+?)==/g, (_m, text) => {
    const stripped = text.replace(/\*\*(.*?)\*\*/g, '$1').trim();
    const explanation = explanations[stripped] || explanations[text.trim()];
    if (explanation) {
      return `<mark data-explanation="${htmlAttrEscape(explanation)}">${text}</mark>`;
    }
    return `<mark>${text}</mark>`;
  });
  if (addDividers) {
    const parts = processed.split(/^(?=### )/gm);
    if (parts.length > 1) {
      processed = parts[0] + parts.slice(1).join('\n\n---\n\n');
    }
  }
  return processed;
};

function flattenChildrenText(children) {
  if (children == null) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(flattenChildrenText).join('');
  if (children.props && children.props.children) return flattenChildrenText(children.props.children);
  return '';
}

function H3WithAnchor({ children, ...props }) {
  const text = flattenChildrenText(children).trim();
  const id = slugify(text) || 'q';
  return <h3 id={id} data-question-text={text} {...props}>{children}</h3>;
}

const ExplanationContext = createContext({
  openId: null,
  setOpenId: () => {},
});

function HighlightMark({ children, ...props }) {
  const explanation = props['data-explanation'];
  const myId = useId();
  const { openId, setOpenId } = useContext(ExplanationContext);
  const isOpen = openId === myId;

  if (!explanation) {
    return <mark>{children}</mark>;
  }

  return (
    <span className="highlight-wrap">
      <mark
        className="highlight-clickable"
        onClick={(e) => {
          e.stopPropagation();
          setOpenId(isOpen ? null : myId);
        }}
        title="클릭해서 수정 설명 보기"
      >
        {children}
      </mark>
      {isOpen && (
        <span
          className="explanation-popup"
          role="tooltip"
          dangerouslySetInnerHTML={{ __html: marked.parseInline(explanation) }}
        />
      )}
    </span>
  );
}

const markdownComponents = { mark: HighlightMark, h3: H3WithAnchor };

function App() {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isPrintMode, setIsPrintMode] = useState(false);

  const [selectedTag, setSelectedTag] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentNoteIndex, setCurrentNoteIndex] = useState(0);

  // Track which explanation popup is currently open (only one at a time).
  const [openExplanationId, setOpenExplanationId] = useState(null);
  const explanationCtx = useMemo(
    () => ({ openId: openExplanationId, setOpenId: setOpenExplanationId }),
    [openExplanationId]
  );

  // Close the popup on any click outside a highlight wrap.
  useEffect(() => {
    if (openExplanationId === null) return;
    const handler = (e) => {
      if (!e.target.closest || !e.target.closest('.highlight-wrap')) {
        setOpenExplanationId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openExplanationId]);

  // Gather all unique tags
  const allTags = useMemo(
    () => [...new Set(allNotes.flatMap(note => note.tags))],
    []
  );

  // Filter notes — memoize so the reference is stable across renders
  // when inputs don't change (otherwise the layout effect below would
  // re-run on every render and lock the UI in a render loop).
  const filteredNotes = useMemo(() => {
    return allNotes.filter(note => {
      const matchesTag = selectedTag ? note.tags.includes(selectedTag) : true;
      const matchesSearch = searchQuery
        ? note.rawText.toLowerCase().includes(searchQuery.toLowerCase())
        : true;
      return matchesTag && matchesSearch;
    });
  }, [selectedTag, searchQuery]);

  // Reset the note index whenever the filtered set changes.
  useEffect(() => {
    setCurrentNoteIndex(0);
  }, [filteredNotes]);

  const safeIndex = Math.min(
    currentNoteIndex,
    Math.max(0, filteredNotes.length - 1)
  );
  const currentNote = filteredNotes[safeIndex];

  // ←/→ to switch between notes (both web and A4 view).
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') {
        setCurrentNoteIndex((i) =>
          Math.min(i + 1, Math.max(0, filteredNotes.length - 1))
        );
      } else if (e.key === 'ArrowLeft') {
        setCurrentNoteIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filteredNotes.length]);

  // Reset scroll position when switching notes.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [safeIndex]);

  const scrollToQuestion = (id) => {
    const el = document.getElementById(id);
    if (el) {
      // Leave a small gap above the heading (about one line) instead of
      // pinning it to the very top of the viewport.
      const offset = 48;
      const top = window.scrollY + el.getBoundingClientRect().top - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  // Draggable position offset for the floating TOC.
  const [tocOffset, setTocOffset] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef(null);

  const startTocDrag = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: tocOffset.x,
      initY: tocOffset.y,
    };
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const onMove = (ev) => {
      const dx = ev.clientX - dragStartRef.current.startX;
      const dy = ev.clientY - dragStartRef.current.startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setTocOffset({
        // Negative x moves right (we'll subtract from `right`), so allow
        // a wide range but keep the TOC at least partially on screen.
        x: clamp(dragStartRef.current.initX + dx, -(vw - 320), 60),
        y: clamp(dragStartRef.current.initY + dy, -(vh / 2 - 80), vh / 2 - 80),
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Calculate layout for print mode — only the currently selected note.
  useEffect(() => {
    if (!isPrintMode || !currentNote) {
      setLoading(false);
      setPages([]);
      return;
    }
    // Wait for the custom font to load before calculating layout
    document.fonts.ready.then(() => {
      const preprocessed = preprocessMarkdown(currentNote.body, { addDividers: false });
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
  }, [currentNote, isPrintMode]);

  if (loading) {
    return <div className="loading">노트 레이아웃 계산 중...</div>;
  }

  return (
    <ExplanationContext.Provider value={explanationCtx}>
    <div className="app-container">
      <div className="controls">
        <div className="controls-header">
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
        
        <div className="filters">
          <div className="search-bar">
            <input
              type="text"
              placeholder="노트 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="tag-list">
            <button
              className={`tag-btn ${selectedTag === null ? 'active' : ''}`}
              onClick={() => setSelectedTag(null)}
            >
              #전체
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                className={`tag-btn ${selectedTag === tag ? 'active' : ''}`}
                onClick={() => setSelectedTag(tag)}
              >
                #{formatTagLabel(tag)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!isPrintMode ? (
        <div className="web-container">
          {currentNote ? (
            <div key={currentNote.id} className="markdown-content note-block">
              {currentNote.tagList.length > 0 && (
                <div className="note-tags">
                  {currentNote.tagList.map((t) => (
                    <span key={t} className="note-tag">#{formatTagLabel(t)}</span>
                  ))}
                </div>
              )}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={markdownComponents}
              >
                {preprocessMarkdown(currentNote.body)}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="no-results">검색 결과가 없습니다.</div>
          )}
        </div>
      ) : currentNote ? (
        <div className="pages-container">
          {pages.map((pageTokens, index) => {
            const pageMarkdown = pageTokens.map(t => t.raw).join('');
            return (
              <div className="page" key={index}>
                <div className="page-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={markdownComponents}
                  >
                    {pageMarkdown}
                  </ReactMarkdown>
                </div>
                <div className="page-number">- {index + 1} -</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="no-results">검색 결과가 없습니다.</div>
      )}

      {currentNote && (
        <aside
          className="floating-toc"
          aria-label="목차"
          style={{
            right: `${28 - tocOffset.x}px`,
            transform: `translateY(calc(-50% + ${tocOffset.y}px))`,
          }}
        >
          <div
            className="toc-drag-handle"
            onMouseDown={startTocDrag}
            title="드래그해서 위치 이동"
            aria-label="드래그 핸들"
          >
            <span /><span /><span />
          </div>
          <div className="toc-nav">
            <button
              type="button"
              className="toc-nav-btn"
              onClick={() => setCurrentNoteIndex((i) => Math.max(i - 1, 0))}
              disabled={safeIndex <= 0}
              aria-label="이전 노트"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="toc-counter">
              {safeIndex + 1} / {filteredNotes.length}
            </span>
            <button
              type="button"
              className="toc-nav-btn"
              onClick={() =>
                setCurrentNoteIndex((i) =>
                  Math.min(i + 1, filteredNotes.length - 1)
                )
              }
              disabled={safeIndex >= filteredNotes.length - 1}
              aria-label="다음 노트"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <h3 className="toc-title">{currentNote.title}</h3>
          {currentNote.questions.length > 0 && (
            <ul className="toc-list">
              {currentNote.questions.map((q) => (
                <li key={q.id}>
                  <a
                    href={`#${q.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToQuestion(q.id);
                    }}
                  >
                    {q.text}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
    </ExplanationContext.Provider>
  );
}

export default App;
