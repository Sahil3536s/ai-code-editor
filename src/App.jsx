import React, { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { Play, Moon, Sun, RotateCcw, Monitor, Terminal } from "lucide-react";

// --- Language Configuration & API Mapping ---
const languages = [
  { 
    id: "python", 
    name: "Python", 
    pistonLang: "python", 
    version: "3.10.0", 
    icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg", 
    defaultCode: "print('Hello Sahil! This is real Python code running.')\nprint(5 + 10)" 
  },
  { 
    id: "javascript", 
    name: "JavaScript", 
    pistonLang: "javascript", 
    version: "18.15.0", 
    icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/javascript/javascript-original.svg", 
    defaultCode: "console.log('Hello Sahil! This is real JS.');\nconsole.log(10 * 10);" 
  },
  { 
    id: "java", 
    name: "Java", 
    pistonLang: "java", 
    version: "15.0.2", 
    icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg", 
    defaultCode: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java!");\n    }\n}` 
  },
  { 
    id: "cpp", 
    name: "C++", 
    pistonLang: "c++", 
    version: "10.2.0", 
    icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg", 
    defaultCode: `#include <iostream>\n\nint main() {\n    std::cout << "Hello from C++";\n    return 0;\n}` 
  },
  { 
    id: "html", 
    name: "HTML", 
    icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/html5/html5-original.svg", 
    defaultCode: "<h1>Hello World</h1>\n<p>This renders in the browser!</p>" 
  },
];

// --- API Service to Execute Code ---
const executeCode = async (language, sourceCode) => {
  // If it's HTML, we don't need the server, we just handle it locally
  if (language.id === "html") return null;

  try {
    const response = await fetch("https://emkc.org/api/v2/piston/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: language.pistonLang,
        version: language.version,
        files: [{ content: sourceCode }],
      }),
    });
    const data = await response.json();
    return data.run.output; // The actual output from the server
  } catch (error) {
    return "Error connecting to execution server.\nPlease check your internet connection.";
  }
};

export default function App() {
  const [activeLang, setActiveLang] = useState(languages[0]);
  const [code, setCode] = useState(activeLang.defaultCode);
  const [output, setOutput] = useState("Click 'Run' to see output here...");
  const [theme, setTheme] = useState("vs-dark"); // Default to Dark Mode
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState("output"); // 'output' or 'preview' (for HTML)

  // Reset code when language changes
  useEffect(() => {
    setCode(activeLang.defaultCode);
    setOutput("Click 'Run' to see output here...");
    // Switch to Preview tab automatically if HTML is selected
    if (activeLang.id === "html") setActiveTab("preview");
    else setActiveTab("output");
  }, [activeLang]);

  const handleRun = async () => {
    if (activeLang.id === "html") {
      setActiveTab("preview"); // Just switch tab, HTML updates live/on-demand
      return;
    }

    setIsRunning(true);
    setOutput("Running code on remote server...");
    const result = await executeCode(activeLang, code);
    setOutput(result);
    setIsRunning(false);
  };

  const isDark = theme === "vs-dark";
  
  // --- Styles ---
  const styles = {
    container: { display: "flex", width: "100vw", height: "100vh", backgroundColor: isDark ? "#1a1a1a" : "#ffffff", color: isDark ? "#e0e0e0" : "#333", fontFamily: "sans-serif" },
    sidebar: { width: "60px", backgroundColor: isDark ? "#252526" : "#f0f0f0", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "15px", borderRight: `1px solid ${isDark ? "#333" : "#ddd"}` },
    main: { flex: 1, display: "flex", flexDirection: "column", maxWidth: "calc(100vw - 60px)" }, // Fixes width issue
    header: { height: "50px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", borderBottom: `1px solid ${isDark ? "#333" : "#ddd"}`, backgroundColor: isDark ? "#1e1e1e" : "#fff" },
    runBtn: { display: "flex", alignItems: "center", gap: "5px", padding: "8px 20px", backgroundColor: "#3b82f6", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" },
    workspace: { flex: 1, display: "flex", flexDirection: "column", height: "calc(100vh - 50px)" },
    editorBox: { flex: 2, minHeight: "300px", borderBottom: `4px solid ${isDark ? "#333" : "#ddd"}` },
    outputBox: { flex: 1, display: "flex", flexDirection: "column", backgroundColor: isDark ? "#0f0f0f" : "#fafafa", minHeight: "150px" },
    outputHeader: { padding: "10px 15px", borderBottom: `1px solid ${isDark ? "#333" : "#ddd"}`, fontSize: "14px", fontWeight: "bold", display: "flex", gap: "15px" },
    pre: { padding: "15px", margin: 0, fontFamily: "monospace", whiteSpace: "pre-wrap", overflow: "auto", flex: 1, color: isDark ? "#4ade80" : "#006600" }, // Green text for terminal feel
    tab: (active) => ({ cursor: "pointer", paddingBottom: "5px", borderBottom: active ? "2px solid #3b82f6" : "none", color: active ? (isDark ? "#fff" : "#000") : "#888" }),
    icon: (active) => ({ width: "32px", height: "32px", padding: "5px", borderRadius: "5px", marginBottom: "15px", cursor: "pointer", backgroundColor: active ? (isDark ? "#3E3E42" : "#fff") : "transparent", border: active ? "1px solid #888" : "none" })
  };

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
        {languages.map(lang => (
          <img key={lang.id} src={lang.icon} alt={lang.name} style={styles.icon(activeLang.id === lang.id)} onClick={() => setActiveLang(lang)} title={lang.name} />
        ))}
      </div>

      {/* Main Content */}
      <div style={styles.main}>
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
             <span style={{ fontWeight: "bold", fontSize: "18px" }}>{activeLang.name} Compiler</span>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setTheme(isDark ? "light" : "vs-dark")} style={{ background: "none", border: "none", cursor: "pointer", color: isDark ? "#fff" : "#333" }}>
               {isDark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button onClick={handleRun} style={styles.runBtn} disabled={isRunning}>
              <Play size={16} fill="white" /> {isRunning ? "Running..." : "Run"}
            </button>
          </div>
        </div>

        {/* Workspace (Top: Editor, Bottom: Output) */}
        <div style={styles.workspace}>
          
          {/* Editor Area */}
          <div style={styles.editorBox}>
            <Editor
              height="100%"
              language={activeLang.id === "c++" ? "cpp" : activeLang.id} // Monaco needs 'cpp' not 'c++'
              theme={theme}
              value={code}
              onChange={(val) => setCode(val)}
              options={{ fontSize: 16, minimap: { enabled: false }, scrollBeyondLastLine: false }}
            />
          </div>

          {/* Output Area */}
          <div style={styles.outputBox}>
            <div style={styles.outputHeader}>
              <span style={styles.tab(activeTab === 'output')} onClick={() => setActiveTab('output')}>
                <Terminal size={14} style={{ marginRight: 5, verticalAlign: 'middle' }}/> Output
              </span>
              {activeLang.id === 'html' && (
                <span style={styles.tab(activeTab === 'preview')} onClick={() => setActiveTab('preview')}>
                  <Monitor size={14} style={{ marginRight: 5, verticalAlign: 'middle' }}/> Web Preview
                </span>
              )}
              <span style={{ marginLeft: "auto", cursor: "pointer" }} onClick={() => setOutput("")} title="Clear Console">
                <RotateCcw size={14} />
              </span>
            </div>

            {/* If HTML, show iframe. If Code, show Terminal text */}
            {activeTab === 'preview' ? (
              <iframe title="web-preview" srcDoc={code} style={{ width: "100%", height: "100%", border: "none", background: "white" }} />
            ) : (
              <pre style={styles.pre}>{output}</pre>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}