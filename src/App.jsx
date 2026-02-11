import React, { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  Play, Bot, Code2, Box, Folder, FileCode, X,
  ArrowLeft, Send, Sun, Moon, Loader2
} from "lucide-react";

// --- 🔴 PASTE YOUR API KEY HERE ---
const API_KEY = "PASTE_YOUR_GEMINI_API_KEY_HERE";

// --- TEMPLATES ---
const TEMPLATES = {
  python: {
    id: "python", name: "Python", icon: "🐍", 
    piston: { lang: "python", ver: "3.10.0" },
    code: "def main():\n    print('Hello from Python!')\n    print('CodeAnywhere is online.')\n\nmain()"
  },
  javascript: {
    id: "javascript", name: "JavaScript", icon: "📜",
    piston: { lang: "javascript", ver: "18.15.0" },
    code: "console.log('Hello from JavaScript!');\nconst greet = (name) => {\n  return `Welcome back, ${name}`;\n}\nconsole.log(greet('Developer'));"
  },
  java: {
    id: "java", name: "Java", icon: "☕",
    piston: { lang: "java", ver: "15.0.2" },
    code: 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello from Java!");\n  }\n}'
  },
  cpp: {
    id: "cpp", name: "C++", icon: "⚙️",
    piston: { lang: "c++", ver: "10.2.0" },
    code: '#include <iostream>\nint main() {\n  std::cout << "Hello from C++";\n  return 0;\n}'
  },
  react: {
    id: "react", name: "React / HTML", icon: "⚛️",
    isWeb: true,
    code: `import React, { useState } from 'react';\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <div style={{ textAlign: 'center', marginTop: '50px', fontFamily: 'sans-serif' }}>\n      <h1 style={{ color: '#3b82f6' }}>Hello React!</h1>\n      <p>Count: <strong>{count}</strong></p>\n      <button onClick={() => setCount(count + 1)}>Increment</button>\n    </div>\n  );\n}`
  }
};

const MOCK_EXTENSIONS = [
  { id: 1, name: "Prettier", desc: "Code formatter", icon: "🅿️" },
  { id: 2, name: "ESLint", desc: "JS Linter", icon: "hz" },
  { id: 3, name: "Docker", desc: "Container support", icon: "🐳" },
];

export default function App() {
  const [view, setView] = useState("landing");
  const [theme, setTheme] = useState("light");
  const [activeLang, setActiveLang] = useState(null);
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const startCoding = (langKey) => {
    setActiveLang(TEMPLATES[langKey]);
    setView("editor");
  };

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  return (
    <>
      {view === "landing" ? (
        <LandingPage onSelectLang={startCoding} theme={theme} toggleTheme={toggleTheme} />
      ) : (
        <EditorPage 
          langConfig={activeLang} 
          theme={theme} 
          toggleTheme={toggleTheme}
          goBack={() => setView("landing")} 
        />
      )}
    </>
  );
}

// --- LANDING PAGE ---
function LandingPage({ onSelectLang, theme, toggleTheme }) {
  const [text, setText] = useState("");
  const fullText = "Code online with CodeAnywhere!";

  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      setText(fullText.slice(0, i));
      i++;
      if (i > fullText.length) clearInterval(timer);
    }, 100); // Slower typing speed (was 50)
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={s.landingContainer}>
      {/* Theme Toggle Button (Top Right of Landing) */}
      <div style={s.topNav}>
         <div style={{fontWeight: "bold", fontSize: 20}}>CodeAnywhere</div>
         <button onClick={toggleTheme} style={s.iconBtn}>
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
         </button>
      </div>

      <div style={{ textAlign: "center", marginTop: 60 }}>
        <h1 style={{ fontSize: "2.5rem", marginBottom: 10 }}>
          <span className="typewriter">{text}</span>
        </h1>
        <p style={{ fontSize: "1.1rem", color: "var(--text-secondary)", marginBottom: 50 }}>
          A powerful, simple, and fast online compiler for everyone.
        </p>

        <div className="card-grid">
          <LangCard id="python" name="Python" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg" onClick={onSelectLang} />
          <LangCard id="javascript" name="JavaScript" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/javascript/javascript-original.svg" onClick={onSelectLang} />
          <LangCard id="java" name="Java" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg" onClick={onSelectLang} />
          <LangCard id="cpp" name="C++" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" onClick={onSelectLang} />
          <LangCard id="react" name="React" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" onClick={onSelectLang} />
        </div>
      </div>
    </div>
  );
}

function LangCard({ id, name, icon, onClick }) {
  return (
    <div className="lang-card" onClick={() => onClick(id)}>
      <img src={icon} alt={name} width={40} height={40} />
      <span style={{ fontSize: "1.1rem", fontWeight: "600", color: "var(--text-primary)" }}>{name}</span>
    </div>
  );
}

// --- EDITOR PAGE ---
function EditorPage({ langConfig, theme, toggleTheme, goBack }) {
  const [code, setCode] = useState(langConfig.code);
  const [output, setOutput] = useState("Ready to run...");
  const [isRunning, setIsRunning] = useState(false);
  const [activeSidebar, setActiveSidebar] = useState("explorer"); 
  
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);

  // --- RUN LOGIC ---
  const handleRun = async () => {
    if (langConfig.isWeb) {
      setOutput("preview");
      return;
    }
    setIsRunning(true);
    setOutput("Running...");
    try {
      const response = await fetch("https://emkc.org/api/v2/piston/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: langConfig.piston.lang,
          version: langConfig.piston.ver,
          files: [{ content: code }],
        }),
      });
      const data = await response.json();
      setOutput(data.run.output || "No output returned.");
    } catch (err) {
      setOutput("Error: Failed to connect to compiler.");
    } finally {
      setIsRunning(false);
    }
  };

  // --- AI LOGIC ---
  const handleAskAI = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);
    try {
      const genAI = new GoogleGenerativeAI(API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-pro" });
      const result = await model.generateContent(`Code:\n${code}\n\nQuestion: ${aiPrompt}`);
      const response = await result.response;
      setAiResponse(response.text());
    } catch (error) {
      setAiResponse("Error: Check API Key or Network.");
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div style={s.editorContainer}>
      {/* ACTIVITY BAR */}
      <div style={s.activityBar}>
        <div onClick={goBack} style={{...s.navBtn, marginBottom: 20}} title="Back Home"><ArrowLeft size={20} /></div>
        <NavBtn icon={<Folder />} active={activeSidebar === "explorer"} onClick={() => setActiveSidebar(activeSidebar === "explorer" ? null : "explorer")} />
        <NavBtn icon={<Box />} active={activeSidebar === "extensions"} onClick={() => setActiveSidebar(activeSidebar === "extensions" ? null : "extensions")} />
        <NavBtn icon={<Bot />} active={activeSidebar === "ai"} onClick={() => setActiveSidebar(activeSidebar === "ai" ? null : "ai")} />
        <div style={{flex: 1}}></div>
        <div onClick={toggleTheme} style={s.navBtn} title="Toggle Theme">
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </div>
      </div>

      {/* SIDEBAR PANEL */}
      {activeSidebar && (
        <div style={s.sidebarPanel}>
          <div style={s.sidebarHeader}>
            {activeSidebar.toUpperCase()}
            <X size={16} cursor="pointer" onClick={() => setActiveSidebar(null)}/>
          </div>
          
          {activeSidebar === 'explorer' && (
            <div style={{padding: 10}}>
              <div style={s.fileItem} className="active">
                <FileCode size={16} color="var(--accent)"/> main.{langConfig.id === 'react' ? 'jsx' : 'txt'}
              </div>
            </div>
          )}

          {activeSidebar === 'extensions' && (
            <div style={{padding: 10}}>
              {MOCK_EXTENSIONS.map(ext => (
                <div key={ext.id} style={s.extCard}>
                  <div style={{fontSize: 20}}>{ext.icon}</div>
                  <div>
                    <div style={{fontWeight: "bold"}}>{ext.name}</div>
                    <div style={{fontSize: 11, opacity: 0.7}}>{ext.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeSidebar === 'ai' && (
            <div style={{display: "flex", flexDirection: "column", height: "100%"}}>
               <div style={{flex: 1, padding: 15, overflowY: "auto", fontSize: 13, whiteSpace: "pre-wrap"}}>
                 {aiResponse || "Ask Gemini anything..."}
               </div>
               <div style={{padding: 10, borderTop: "1px solid var(--border)"}}>
                 <div style={{display: "flex", gap: 5}}>
                    <input style={s.input} value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="Ask..." onKeyDown={e=>e.key==='Enter'&&handleAskAI()}/>
                    <button onClick={handleAskAI} style={s.sendBtn}>{isAiLoading ? <Loader2 className="spin" size={14}/> : <Send size={14}/>}</button>
                 </div>
               </div>
            </div>
          )}
        </div>
      )}

      {/* MAIN EDITOR AREA */}
      <div style={{flex: 1, display: "flex", flexDirection: "column"}}>
        <header style={s.header}>
           <div style={{display: "flex", alignItems: "center", gap: 10}}>
             <span>{langConfig.name}</span>
           </div>
           <button onClick={handleRun} disabled={isRunning} style={s.runBtn}>
             {isRunning ? <Loader2 className="spin" size={16}/> : <Play size={16}/>} Run
           </button>
        </header>

        <div style={{flex: 1, display: "flex", flexDirection: "column"}}>
          <Editor
            height="70%"
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            language={langConfig.piston ? langConfig.piston.lang : 'javascript'}
            value={code}
            onChange={(v) => setCode(v)}
            options={{ fontSize: 14, minimap: { enabled: false }, padding: { top: 20 } }}
          />
          
          <div style={s.outputPanel}>
            <div style={s.outputHeader}>Output</div>
            {output === "preview" && langConfig.isWeb ? (
              <iframe 
                srcDoc={`<html><body><script src="https://unpkg.com/react@18/umd/react.development.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script><script src="https://unpkg.com/@babel/standalone/babel.min.js"></script><div id="root"></div><script type="text/babel">${code}; const root = ReactDOM.createRoot(document.getElementById('root')); root.render(<App />);</script></body></html>`}
                style={{width: "100%", height: "100%", border: "none", background: "white"}} 
              />
            ) : (
              <pre style={s.terminal}>{output}</pre>
            )}
          </div>
        </div>
      </div>
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const NavBtn = ({ icon, active, onClick }) => (
  <div onClick={onClick} style={{...s.navBtn, color: active ? "var(--accent)" : "var(--text-secondary)", borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent"}}>
    {icon}
  </div>
);

// --- STYLES ---
const s = {
  landingContainer: { minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-primary)" },
  topNav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 40px" },
  iconBtn: { background: "transparent", border: "1px solid var(--border)", padding: 10, borderRadius: "50%", cursor: "pointer", color: "var(--text-primary)" },
  
  editorContainer: { display: "flex", height: "100vh", background: "var(--bg-primary)" },
  activityBar: { width: 50, background: "var(--bg-secondary)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 20, paddingBottom: 20 },
  navBtn: { width: 50, height: 50, display: "flex", justifyContent: "center", alignItems: "center", cursor: "pointer", transition: "0.2s" },
  
  sidebarPanel: { width: 250, background: "var(--bg-secondary)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" },
  sidebarHeader: { height: 40, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 15px", fontSize: 12, fontWeight: "bold" },
  
  header: { height: 50, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px" },
  runBtn: { background: "var(--accent)", color: "white", border: "none", padding: "8px 20px", borderRadius: 6, cursor: "pointer", display: "flex", gap: 8, alignItems: "center", fontWeight: "600" },
  outputPanel: { flex: 1, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", background: "var(--bg-primary)" },
  outputHeader: { padding: "5px 15px", fontSize: 12, fontWeight: "bold", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)" },
  terminal: { padding: 15, fontFamily: "monospace", color: "var(--text-primary)", overflow: "auto" },
  
  input: { flex: 1, padding: 8, borderRadius: 4, border: "1px solid var(--border)", outline: "none", background: "var(--bg-primary)", color: "var(--text-primary)" },
  sendBtn: { background: "var(--accent)", color: "white", border: "none", width: 35, borderRadius: 4, cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center" },
  extCard: { display: "flex", gap: 10, padding: 10, borderBottom: "1px solid var(--border)", alignItems: "center" },
  fileItem: { display: "flex", gap: 8, padding: "8px 15px", alignItems: "center", fontSize: 13, cursor: "pointer", color: "var(--text-primary)" }
};