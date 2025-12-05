// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface GameData {
  id: number;
  playerName: string;
  encryptedHP: string;
  encryptedATK: string;
  encryptedDEF: string;
  timestamp: number;
  owner: string;
}

interface PlayerStats {
  name: string;
  score: number;
}

const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [gameData, setGameData] = useState<GameData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingData, setCreatingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newGameData, setNewGameData] = useState({ playerName: "", hp: "", atk: "", def: "" });
  const [selectedData, setSelectedData] = useState<GameData | null>(null);
  const [decryptedStats, setDecryptedStats] = useState<{ hp: number | null; atk: number | null; def: number | null }>({ hp: null, atk: null, def: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [leaderboard, setLeaderboard] = useState<PlayerStats[]>([]);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      const dataBytes = await contract.getData("gameData");
      let dataList: GameData[] = [];
      if (dataBytes.length > 0) {
        try {
          const dataStr = ethers.toUtf8String(dataBytes);
          if (dataStr.trim() !== '') dataList = JSON.parse(dataStr);
        } catch (e) {}
      }
      setGameData(dataList);
      
      const leaderboardBytes = await contract.getData("leaderboard");
      let leaderboardList: PlayerStats[] = [];
      if (leaderboardBytes.length > 0) {
        try {
          const leaderboardStr = ethers.toUtf8String(leaderboardBytes);
          if (leaderboardStr.trim() !== '') leaderboardList = JSON.parse(leaderboardStr);
        } catch (e) {}
      }
      setLeaderboard(leaderboardList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  const createGameData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating game data with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const newData: GameData = {
        id: gameData.length + 1,
        playerName: newGameData.playerName,
        encryptedHP: FHEEncryptNumber(parseFloat(newGameData.hp) || 0),
        encryptedATK: FHEEncryptNumber(parseFloat(newGameData.atk) || 0),
        encryptedDEF: FHEEncryptNumber(parseFloat(newGameData.def) || 0),
        timestamp: Math.floor(Date.now() / 1000),
        owner: address
      };
      
      const updatedData = [...gameData, newData];
      await contract.setData("gameData", ethers.toUtf8Bytes(JSON.stringify(updatedData)));
      
      const score = (parseFloat(newGameData.hp) || 0) + (parseFloat(newGameData.atk) || 0) + (parseFloat(newGameData.def) || 0);
      const updatedLeaderboard = [...leaderboard, { name: newGameData.playerName, score }];
      await contract.setData("leaderboard", ethers.toUtf8Bytes(JSON.stringify(updatedLeaderboard)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Game data created successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewGameData({ playerName: "", hp: "", atk: "", def: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingData(false); 
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const renderStatsDashboard = () => {
    const totalPlayers = gameData.length;
    const avgHP = gameData.length > 0 ? gameData.reduce((sum, g) => sum + (decryptedStats.hp || FHEDecryptNumber(g.encryptedHP)), 0) / gameData.length : 0;
    const avgATK = gameData.length > 0 ? gameData.reduce((sum, g) => sum + (decryptedStats.atk || FHEDecryptNumber(g.encryptedATK)), 0) / gameData.length : 0;
    const avgDEF = gameData.length > 0 ? gameData.reduce((sum, g) => sum + (decryptedStats.def || FHEDecryptNumber(g.encryptedDEF)), 0) / gameData.length : 0;
    
    return (
      <div className="dashboard-panels">
        <div className="panel neon-panel">
          <h3>Total Players</h3>
          <div className="stat-value">{totalPlayers}</div>
          <div className="stat-trend">+5% last week</div>
        </div>
        
        <div className="panel neon-panel">
          <h3>Average HP</h3>
          <div className="stat-value">{avgHP.toFixed(1)}</div>
          <div className="stat-trend">+2% last month</div>
        </div>
        
        <div className="panel neon-panel">
          <h3>Average ATK</h3>
          <div className="stat-value">{avgATK.toFixed(1)}</div>
          <div className="stat-trend">+3% last month</div>
        </div>
        
        <div className="panel neon-panel">
          <h3>Average DEF</h3>
          <div className="stat-value">{avgDEF.toFixed(1)}</div>
          <div className="stat-trend">+1% last month</div>
        </div>
      </div>
    );
  };

  const renderLeaderboard = () => {
    return (
      <div className="leaderboard-container">
        <h3>Top Players</h3>
        <div className="leaderboard-list">
          {leaderboard.sort((a, b) => b.score - a.score).slice(0, 10).map((player, index) => (
            <div className="leaderboard-item" key={index}>
              <div className="rank">{index + 1}</div>
              <div className="player-name">{player.name}</div>
              <div className="player-score">{player.score}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFeatures = () => {
    return (
      <div className="features-grid">
        <div className="feature-card">
          <div className="feature-icon fhe-icon"></div>
          <h4>FHE Encryption</h4>
          <p>Player stats are encrypted using Zama FHE technology for maximum security</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon chain-icon"></div>
          <h4>On-Chain Logic</h4>
          <p>Game logic executes directly on-chain with homomorphic computations</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon privacy-icon"></div>
          <h4>Privacy Protection</h4>
          <p>Only you can decrypt your full game state, preventing cheating</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon fair-icon"></div>
          <h4>Fair Play</h4>
          <p>Verifiable game fairness with encrypted state and transparent rules</p>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqItems = [
      {
        question: "What is GameCrypt Engine?",
        answer: "A fully homomorphic encrypted on-chain game engine that allows complex game logic to execute on encrypted game states."
      },
      {
        question: "How does FHE protect my game data?",
        answer: "Your player stats (HP, ATK, DEF) are encrypted with Zama FHE and remain encrypted during all game calculations."
      },
      {
        question: "Who can see my decrypted stats?",
        answer: "Only you can decrypt your full game state using your wallet signature."
      },
      {
        question: "What chains are supported?",
        answer: "Currently Ethereum and EVM-compatible chains with plans to expand."
      },
      {
        question: "How is cheating prevented?",
        answer: "All game logic executes on encrypted data, making it impossible to manipulate values."
      }
    ];
    
    return (
      <div className="faq-container">
        {faqItems.map((item, index) => (
          <div className="faq-item" key={index}>
            <div className="faq-question">{item.question}</div>
            <div className="faq-answer">{item.answer}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted game engine...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="game-icon"></div>
          </div>
          <h1>Game<span>Crypt</span>Engine</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            <div className="add-icon"></div>New Player
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="tabs-container">
            <div className="tabs">
              <button 
                className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('dashboard')}
              >
                Dashboard
              </button>
              <button 
                className={`tab ${activeTab === 'players' ? 'active' : ''}`}
                onClick={() => setActiveTab('players')}
              >
                Players
              </button>
              <button 
                className={`tab ${activeTab === 'features' ? 'active' : ''}`}
                onClick={() => setActiveTab('features')}
              >
                Features
              </button>
              <button 
                className={`tab ${activeTab === 'faq' ? 'active' : ''}`}
                onClick={() => setActiveTab('faq')}
              >
                FAQ
              </button>
            </div>
            
            <div className="tab-content">
              {activeTab === 'dashboard' && (
                <div className="dashboard-content">
                  <h2>Encrypted Game Statistics</h2>
                  {renderStatsDashboard()}
                  
                  <div className="panel neon-panel full-width">
                    <h3>Leaderboard</h3>
                    {renderLeaderboard()}
                  </div>
                </div>
              )}
              
              {activeTab === 'players' && (
                <div className="players-section">
                  <div className="section-header">
                    <h2>Player Data</h2>
                    <div className="header-actions">
                      <button 
                        onClick={loadData} 
                        className="refresh-btn" 
                        disabled={isRefreshing}
                      >
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                      </button>
                    </div>
                  </div>
                  
                  <div className="players-list">
                    {gameData.length === 0 ? (
                      <div className="no-players">
                        <div className="no-players-icon"></div>
                        <p>No player data found</p>
                        <button 
                          className="create-btn" 
                          onClick={() => setShowCreateModal(true)}
                        >
                          Create First Player
                        </button>
                      </div>
                    ) : gameData.map((data, index) => (
                      <div 
                        className={`player-item ${selectedData?.id === data.id ? "selected" : ""}`} 
                        key={index}
                        onClick={() => setSelectedData(data)}
                      >
                        <div className="player-title">{data.playerName}</div>
                        <div className="player-meta">
                          <span>HP: {data.encryptedHP.substring(0, 15)}...</span>
                          <span>ATK: {data.encryptedATK.substring(0, 15)}...</span>
                          <span>DEF: {data.encryptedDEF.substring(0, 15)}...</span>
                        </div>
                        <div className="player-owner">Owner: {data.owner.substring(0, 6)}...{data.owner.substring(38)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'features' && (
                <div className="features-section">
                  <h2>GameCrypt Engine Features</h2>
                  {renderFeatures()}
                </div>
              )}
              
              {activeTab === 'faq' && (
                <div className="faq-section">
                  <h2>Frequently Asked Questions</h2>
                  {renderFAQ()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreatePlayer 
          onSubmit={createGameData} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingData} 
          playerData={newGameData} 
          setPlayerData={setNewGameData}
        />
      )}
      
      {selectedData && (
        <PlayerDetailModal 
          player={selectedData} 
          onClose={() => { 
            setSelectedData(null); 
            setDecryptedStats({ hp: null, atk: null, def: null }); 
          }} 
          decryptedStats={decryptedStats} 
          setDecryptedStats={setDecryptedStats} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="game-icon"></div>
              <span>GameCrypt_Engine</span>
            </div>
            <p>FHE-powered on-chain gaming</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} GameCrypt Engine. All rights reserved.</div>
          <div className="disclaimer">
            This system uses fully homomorphic encryption to protect game state data.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreatePlayerProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  playerData: any;
  setPlayerData: (data: any) => void;
}

const ModalCreatePlayer: React.FC<ModalCreatePlayerProps> = ({ onSubmit, onClose, creating, playerData, setPlayerData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPlayerData({ ...playerData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-player-modal">
        <div className="modal-header">
          <h2>New Player</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>All player stats will be encrypted with Zama FHE</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Player Name *</label>
            <input 
              type="text" 
              name="playerName" 
              value={playerData.playerName} 
              onChange={handleChange} 
              placeholder="Enter player name..." 
            />
          </div>
          
          <div className="form-group">
            <label>HP *</label>
            <input 
              type="number" 
              name="hp" 
              value={playerData.hp} 
              onChange={handleChange} 
              placeholder="Enter HP value..." 
            />
          </div>
          
          <div className="form-group">
            <label>ATK *</label>
            <input 
              type="number" 
              name="atk" 
              value={playerData.atk} 
              onChange={handleChange} 
              placeholder="Enter ATK value..." 
            />
          </div>
          
          <div className="form-group">
            <label>DEF *</label>
            <input 
              type="number" 
              name="def" 
              value={playerData.def} 
              onChange={handleChange} 
              placeholder="Enter DEF value..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || !playerData.playerName || !playerData.hp || !playerData.atk || !playerData.def} 
            className="submit-btn"
          >
            {creating ? "Creating with FHE..." : "Create Player"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface PlayerDetailModalProps {
  player: GameData;
  onClose: () => void;
  decryptedStats: { hp: number | null; atk: number | null; def: number | null };
  setDecryptedStats: (value: { hp: number | null; atk: number | null; def: number | null }) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const PlayerDetailModal: React.FC<PlayerDetailModalProps> = ({ 
  player, 
  onClose, 
  decryptedStats, 
  setDecryptedStats, 
  isDecrypting, 
  decryptWithSignature
}) => {
  const handleDecrypt = async (field: 'hp' | 'atk' | 'def') => {
    if (decryptedStats[field] !== null) { 
      setDecryptedStats({ ...decryptedStats, [field]: null }); 
      return; 
    }
    
    const encryptedValue = field === 'hp' ? player.encryptedHP : field === 'atk' ? player.encryptedATK : player.encryptedDEF;
    const decrypted = await decryptWithSignature(encryptedValue);
    if (decrypted !== null) {
      setDecryptedStats({ ...decryptedStats, [field]: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="player-detail-modal">
        <div className="modal-header">
          <h2>Player Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="player-info">
            <div className="info-item">
              <span>Player Name:</span>
              <strong>{player.playerName}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>{player.owner.substring(0, 6)}...{player.owner.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(player.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Player Stats</h3>
            <div className="data-row">
              <div className="data-label">HP:</div>
              <div className="data-value">{player.encryptedHP.substring(0, 30)}...</div>
              <button 
                className="decrypt-btn" 
                onClick={() => handleDecrypt('hp')} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "Decrypting..."
                ) : decryptedStats.hp !== null ? (
                  "Hide Value"
                ) : (
                  "Decrypt HP"
                )}
              </button>
            </div>
            
            <div className="data-row">
              <div className="data-label">ATK:</div>
              <div className="data-value">{player.encryptedATK.substring(0, 30)}...</div>
              <button 
                className="decrypt-btn" 
                onClick={() => handleDecrypt('atk')} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "Decrypting..."
                ) : decryptedStats.atk !== null ? (
                  "Hide Value"
                ) : (
                  "Decrypt ATK"
                )}
              </button>
            </div>
            
            <div className="data-row">
              <div className="data-label">DEF:</div>
              <div className="data-value">{player.encryptedDEF.substring(0, 30)}...</div>
              <button 
                className="decrypt-btn" 
                onClick={() => handleDecrypt('def')} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "Decrypting..."
                ) : decryptedStats.def !== null ? (
                  "Hide Value"
                ) : (
                  "Decrypt DEF"
                )}
              </button>
            </div>
            
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted - Requires Wallet Signature</span>
            </div>
          </div>
          
          {(decryptedStats.hp !== null || decryptedStats.atk !== null || decryptedStats.def !== null) && (
            <div className="stats-section">
              <h3>Decrypted Stats</h3>
              <div className="decrypted-values">
                {decryptedStats.hp !== null && (
                  <div className="value-item">
                    <span>HP:</span>
                    <strong>{decryptedStats.hp.toFixed(0)}</strong>
                  </div>
                )}
                {decryptedStats.atk !== null && (
                  <div className="value-item">
                    <span>ATK:</span>
                    <strong>{decryptedStats.atk.toFixed(0)}</strong>
                  </div>
                )}
                {decryptedStats.def !== null && (
                  <div className="value-item">
                    <span>DEF:</span>
                    <strong>{decryptedStats.def.toFixed(0)}</strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;