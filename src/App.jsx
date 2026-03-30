import React, { useState, useEffect } from "react";
import { Analytics } from "@vercel/analytics/react"
import Editor from "@monaco-editor/react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  Play, Bot, Code2, Box, Folder, FileCode, X,
  ArrowLeft, Send, Sun, Moon, Loader2
} from "lucide-react";

// --- 🔴 PASTE YOUR API KEY HERE ---
const API_KEY = "PASTE_YOUR_GEMINI_API_KEY_HERE";

// --- SPLASH BUTTON COMPONENT ---
const SplashButton = ({ children, onClick, className, style }) => {
  const canvasRef = React.useRef(null);
  const splatsRef = React.useRef([]);

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    splatsRef.current.push({
      x, y,
      color: `hsla(${Math.random() * 60 + 200}, 100%, 75%, 0.6)`,
      size: Math.random() * 15 + 5,
      life: 1
    });
  };

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;
    
    const resize = () => {
      canvas.width = canvas.parentElement.offsetWidth;
      canvas.height = canvas.parentElement.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const splats = splatsRef.current;
      
      for (let i = splats.length - 1; i >= 0; i--) {
        const s = splats[i];
        ctx.globalAlpha = s.life;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        
        s.life -= 0.05;
        s.size += 0.5;
        if (s.life <= 0) splats.splice(i, 1);
      }
      ctx.globalAlpha = 1;
      animationId = requestAnimationFrame(draw);
    };
    draw();
    
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <div 
      style={{ position: "relative", display: "inline-block", overflow: "hidden", borderRadius: style?.borderRadius || 30, ...style }}
      onMouseMove={handleMouseMove}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", zIndex: 1 }} />
      <button className={className} onClick={onClick} style={{ margin: 0, position: "relative", zIndex: 5 }}>
        {children}
      </button>
    </div>
  );
};

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
  const [activeTab, setActiveTab] = useState("home");
  const [showAuthModal, setShowAuthModal] = useState(false);
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
    <div className="landing-container" style={s.landingContainer}>
      {/* Background Glow Shapes */}
      <div className="bg-glow-1"></div>
      <div className="bg-glow-2"></div>

      {/* Theme Toggle Button (Top Right of Landing) */}
      {/* Theme Toggle Button & Sign In (Top Right) */}
      <div style={s.topNav}>
         <div style={{fontWeight: "bold", fontSize: 24, letterSpacing: "-0.5px"}}>CodeAnywhere</div>
         <div className="nav-links">
            <a href="#" className={activeTab === 'home' ? 'nav-active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('home'); }}>Home</a>
            <a href="#" className={activeTab === 'features' ? 'nav-active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('features'); }}>Features</a>
            <a href="#" className={activeTab === 'languages' ? 'nav-active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('languages'); }}>Languages</a>
            <a href="#" className={activeTab === 'about' ? 'nav-active' : ''} onClick={(e) => { e.preventDefault(); setActiveTab('about'); }}>About</a>
         </div>
         <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
            <button onClick={toggleTheme} style={s.iconBtn} title="Toggle theme">
               {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <button className="sign-in-btn" onClick={() => setShowAuthModal(true)}>Sign In</button>
         </div>
      </div>

      {activeTab === 'home' && (
        <div style={{ textAlign: "center", marginTop: 60 }}>
          <h1 style={{ fontSize: "2.5rem", marginBottom: 10 }}>
            <span className="typewriter">{text}</span>
          </h1>
          <p style={{ fontSize: "1.25rem", fontWeight: "500", textShadow: "0 2px 10px rgba(0,0,0,0.15)", color: "var(--text-secondary)", marginBottom: 30 }}>
            A powerful, simple, and fast online compiler for everyone.
          </p>

          <button className="cta-btn pulse-glow-btn" onClick={() => onSelectLang('javascript')}>
            <Play size={18} fill="currentColor" /> Start Coding
          </button>

          <div style={{ marginTop: 80, marginBottom: 20, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: "700", color: "var(--text-secondary)", opacity: 0.8 }}>
            Choose your language
          </div>

          <div className="card-grid">
            <LangCard id="python" name="Python" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg" onClick={onSelectLang} />
            <LangCard id="javascript" name="JavaScript" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/javascript/javascript-original.svg" onClick={onSelectLang} />
            <LangCard id="java" name="Java" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg" onClick={onSelectLang} />
            <LangCard id="cpp" name="C++" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" onClick={onSelectLang} />
            <LangCard id="react" name="React" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" onClick={onSelectLang} />
          </div>
        </div>
      )}

      {activeTab === 'features' && (
        <div className="features-view" style={{ textAlign: "center", marginTop: 80, padding: "0 20px", position: "relative", minHeight: "60vh", overflow: "hidden" }}>
          
          <AntigravityParticleField />
          <div className="coming-blob-1"></div>
          <div className="coming-blob-2"></div>

          <div style={{ position: "relative", zIndex: 10 }}>
            <h1 className="feature-title" style={{ animation: "scaleIn 1s cubic-bezier(0.16, 1, 0.3, 1) forwards", opacity: 0 }}>
              Revolutionary capabilities<br/>
              <span className="shimmer-text" style={{ position: "relative", display: "inline-block", marginTop: "10px" }}>Coming Soon</span>
            </h1>
            <p style={{ fontSize: "1.15rem", color: "var(--text-secondary)", maxWidth: 600, margin: "20px auto 40px", lineHeight: 1.6, animation: "fadeInUp 0.8s ease forwards", animationDelay: "0.2s", opacity: 0 }}>
              We're building the ultimate cloud developer experience. Soon, you'll be able to collaborate with multi-player editing, deploy to the edge in seconds, and utilize personalized AI agents completely natively.
            </p>
            <button className="cta-btn pulse-glow-btn" onClick={() => setActiveTab('home')} style={{ padding: "14px 32px", fontSize: "1rem", animation: "fadeInUp 0.8s ease forwards", animationDelay: "0.4s", opacity: 0 }}>
              <ArrowLeft size={16} /> Return to Home
            </button>
          </div>
        </div>
      )}

      {activeTab === 'languages' && (
        <div style={{ textAlign: "center", marginTop: 70, position: "relative", minHeight: "60vh", animation: "pageFadeIn 0.8s ease-out forwards" }}>
          
          <div style={{ marginBottom: 15, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: "700", color: "var(--text-secondary)", opacity: 0.8 }}>
            Ecosystem
          </div>
          <h1 className="about-title" style={{ fontSize: "3.5rem", marginBottom: 15 }}>
            Supported Languages
          </h1>
          <p style={{ fontSize: "1.15rem", color: "var(--text-secondary)", marginBottom: 50, maxWidth: 600, margin: "0 auto 50px", lineHeight: 1.6, opacity: 0.85 }}>
            Compile, run, and ship applications directly in the browser. Powered by instant edge containers and deep intelligence.
          </p>

          <div className="card-grid" style={{ marginTop: 0 }}>
            <LangCard id="python" name="Python" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg" onClick={onSelectLang} />
            <LangCard id="javascript" name="JavaScript" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/javascript/javascript-original.svg" onClick={onSelectLang} />
            <LangCard id="typescript" name="TypeScript" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/typescript/typescript-original.svg" onClick={onSelectLang} />
            <LangCard id="java" name="Java" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg" onClick={onSelectLang} />
            <LangCard id="cpp" name="C++" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" onClick={onSelectLang} />
            <LangCard id="csharp" name="C#" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/csharp/csharp-original.svg" onClick={onSelectLang} />
            <LangCard id="go" name="Go" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/go/go-original.svg" onClick={onSelectLang} />
            <LangCard id="rust" name="Rust" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-plain.svg" onClick={onSelectLang} />
            <LangCard id="ruby" name="Ruby" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/ruby/ruby-original.svg" onClick={onSelectLang} />
            <LangCard id="php" name="PHP" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/php/php-original.svg" onClick={onSelectLang} />
            <LangCard id="swift" name="Swift" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/swift/swift-original.svg" onClick={onSelectLang} />
            <LangCard id="kotlin" name="Kotlin" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/kotlin/kotlin-original.svg" onClick={onSelectLang} />
            <LangCard id="dart" name="Dart" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/dart/dart-original.svg" onClick={onSelectLang} />
            <LangCard id="html" name="HTML5" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/html5/html5-original.svg" onClick={onSelectLang} />
            <LangCard id="react" name="React" icon="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" onClick={onSelectLang} />
          </div>
          
          <button className="cta-btn" onClick={() => setActiveTab('home')} style={{ marginTop: 20, marginBottom: 60 }}>
             <ArrowLeft size={16} /> Return home
          </button>
        </div>
      )}

      {activeTab === 'about' && (
        <div className="about-view" style={{ textAlign: "center", marginTop: 40, padding: "0 20px", position: "relative", minHeight: "60vh", display: "flex", justifyContent: "center", alignItems: "center" }}>
          
          {/* Radial soft glow behind card */}
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 600, height: 600, background: "radial-gradient(circle, rgba(139, 92, 246, 0.12) 0%, transparent 60%)", filter: "blur(70px)", pointerEvents: "none", zIndex: 0 }}></div>

          <div className="about-card" style={{ position: "relative", zIndex: 10, background: "var(--card-bg)", padding: "40px 30px", borderRadius: 24, maxWidth: 650, margin: "0 auto", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid var(--glass-border)", boxShadow: "0 20px 50px rgba(0, 0, 0, 0.08)", overflow: "hidden", animation: "pageFadeIn 0.8s ease-out forwards", opacity: 0 }}>
            
            <AntigravityParticleField />
            
            <div style={{ position: "relative", zIndex: 5, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ marginBottom: 15, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: "700", color: "var(--text-secondary)", opacity: 0.8 }}>
                About
              </div>
              <h1 className="about-title">CodeAnywhere</h1>
              
              <p style={{ fontSize: "1.1rem", color: "var(--text-secondary)", lineHeight: 1.9, marginBottom: 20, textAlign: "center", maxWidth: 550, opacity: 0.85 }}>
                 CodeAnywhere is a next-generation, lightning-fast cloud IDE designed to break down the barriers of software development. Our mission is to provide developers with a frictionless, instantaneously available coding environment accessible from any browser.
              </p>
              
              <p style={{ fontSize: "1.1rem", color: "var(--text-secondary)", lineHeight: 1.9, marginBottom: 40, textAlign: "center", maxWidth: 550, opacity: 0.85 }}>
                 Powered by advanced AI pair programming via Google's Gemini API, secure edge-containers, and an obsessively refined user interface, CodeAnywhere lets you compile, run, and ship code at anti-gravity speeds. Welcome to the future of development.
              </p>
              
              <SplashButton className="cta-btn" onClick={() => setActiveTab('home')} style={{ marginTop: 10 }}>
                <ArrowLeft size={18} /> Return home
              </SplashButton>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal Overlay */}
      {showAuthModal && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 9999, display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", animation: "pageFadeIn 0.3s ease" }}>
          <div style={{ background: "var(--card-bg)", padding: "40px 35px", borderRadius: 24, width: "100%", maxWidth: 420, border: "1px solid var(--glass-border)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)", position: "relative" }}>
            <button onClick={() => setShowAuthModal(false)} style={{ position: "absolute", top: 20, right: 20, background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}><X size={20} /></button>
            <h2 style={{ marginBottom: 10, fontSize: "1.8rem", color: "var(--text-primary)", fontWeight: "800", letterSpacing: "-0.5px" }}>Welcome Back</h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: 30, fontSize: "0.95rem" }}>Sign in to sync your workspaces across devices.</p>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
              <input type="email" placeholder="Email address" style={{ width: "100%", padding: "14px 16px", borderRadius: 12, background: "var(--bg-main)", border: "2px solid var(--glass-border)", color: "var(--text-primary)", outline: "none", fontSize: "1rem", transition: "border-color 0.2s" }} onFocus={(e) => e.target.style.borderColor = "#3b82f6"} onBlur={(e) => e.target.style.borderColor = "var(--glass-border)"} />
              <input type="password" placeholder="Password" style={{ width: "100%", padding: "14px 16px", borderRadius: 12, background: "var(--bg-main)", border: "2px solid var(--glass-border)", color: "var(--text-primary)", outline: "none", fontSize: "1rem", transition: "border-color 0.2s" }} onFocus={(e) => e.target.style.borderColor = "#3b82f6"} onBlur={(e) => e.target.style.borderColor = "var(--glass-border)"} />
              <button className="cta-btn pulse-glow-btn" onClick={() => setShowAuthModal(false)} style={{ width: "100%", padding: 16, marginTop: 10, borderRadius: 12, border: "none", fontSize: "1.05rem", fontWeight: "600" }}>Sign In</button>
            </div>
            <p style={{ color: "var(--text-secondary)", marginTop: 25, fontSize: "0.85rem", textAlign: "center" }}>
              Don't have an account? <a href="#" style={{ color: "#3b82f6", textDecoration: "none", fontWeight: "600" }} onClick={(e) => e.preventDefault()}>Sign up</a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// --- ANTIGRAVITY PARTICLE SYSTEM ---
const AntigravityParticleField = () => {
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const resize = () => {
      if (canvas.parentElement) {
        // Confine the particle field directly to the parent frosted UI card
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    // Allow React layout to settle before initial grab
    setTimeout(resize, 0);

    const particles = [];
    const numParticles = 250; 
    const colors = ['#fca5a5', '#fde047', '#86efac', '#93c5fd', '#c4b5fd', '#f9a8d4', '#5eead4'];

    for (let i = 0; i < numParticles; i++) {
       const angle = Math.random() * Math.PI * 2;
       const radius = Math.random() * 400; // localized spread
       
       particles.push({
         x: canvas.width / 2 + Math.cos(angle) * radius,
         y: canvas.height / 2 + Math.sin(angle) * radius,
         vx: (Math.random() - 0.5) * 0.3 + Math.cos(angle) * (0.1 + Math.random() * 0.2), // Random radial spread
         vy: (Math.random() - 0.5) * 0.3 + Math.sin(angle) * (0.1 + Math.random() * 0.2),
         color: colors[Math.floor(Math.random() * colors.length)],
         size: Math.random() * 2 + 0.5,
         alpha: Math.random() * 0.4 + 0.1
       });
    }

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      particles.forEach(p => {
        // Slow float
        p.x += p.vx;
        p.y += p.vy;

        // Loop infinitely if out of bounds (radial reset)
        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > Math.max(canvas.width, canvas.height)) {
            p.x = cx;
            p.y = cy;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        
        // Low opacity radial fade (fades out as it leaves center)
        const fade = Math.max(0, 1 - (dist / (Math.max(canvas.width, canvas.height))));
        ctx.globalAlpha = p.alpha * fade;
        
        ctx.fill();
      });

      animationFrameId = window.requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      window.cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      style={{ 
        position: 'absolute', 
        top: 0, 
        left: 0, 
        width: '100%', 
        height: '100%', 
        pointerEvents: 'none',
        zIndex: -1,
        opacity: 0.45 
      }} 
    />
  );
};

function LangCard({ id, name, icon, onClick }) {
  return (
    <div className={`lang-card ${id}`} onClick={() => onClick(id)}>
      {id === 'python' && <div className="badge popular">Popular</div>}
      {id === 'react' && <div className="badge trending">Trending</div>}
      <img src={icon} alt={name} width={40} height={40} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
        <span style={{ fontSize: "1.1rem", fontWeight: "600", color: "var(--text-primary)" }}>{name}</span>
        <span className="card-subtitle" style={{ color: "var(--text-primary)", opacity: 0.85 }}>Click to open editor</span>
      </div>
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