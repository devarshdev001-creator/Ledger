import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { BalanceDisplay } from './components/BalanceDisplay';
import { QuickActions } from './components/QuickActions';
import { TransactionsList } from './components/TransactionsList';
import { HistoryView } from './components/HistoryView';
import { SettingsScreen } from './components/SettingsScreen';
import { AboutPage } from './components/AboutPage';
import { AddTransactionModal } from './components/AddTransactionModal';
import { AddSiteModal } from './components/AddSiteModal';
import { LoginScreen } from './components/LoginScreen';
import { SignupScreen } from './components/SignupScreen';
import { TabBar } from './components/TabBar';
import { SuppliersView } from './components/SuppliersView';
import { SitesView } from './components/SitesView';
import { DatabaseSetupBanner } from './components/DatabaseSetupBanner';
import { DatabaseCheckModal } from './components/DatabaseCheckModal';
import { getTranslation, Language } from './translations';
import { createClient } from './utils/supabase/client';
import { projectId, publicAnonKey } from './utils/supabase/info';
import { registerServiceWorker } from './utils/pwa'; // PWA support
import { 
  getTransactions, 
  getSites, 
  addTransaction as dbAddTransaction,
  updateTransaction as dbUpdateTransaction,
  deleteTransaction as dbDeleteTransaction,
  addSite as dbAddSite,
  deleteSite as dbDeleteSite,
  getUserPreferences,
  updateUserPreferences,
  checkDatabaseSetup 
} from './utils/database';

export interface Transaction {
  id: string;
  name: string;
  amount: number;
  type: 'in' | 'out';
  personType: 'worker' | 'supplier';
  note: string;
  additionalNotes?: string;
  date: string;
  site?: string; // Site name extracted from name field using "/" delimiter
}

export interface Site {
  id: string;
  name: string;
  budget: number;
  createdDate: string;
}

export default function App() {
  // Auth state
  const [user, setUser] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authView, setAuthView] = useState<'login' | 'signup'>('login');

  // App state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [activeView, setActiveView] = useState<'home' | 'history' | 'settings' | 'suppliers' | 'sites' | 'about'>('home');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSiteModalOpen, setIsSiteModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [userName, setUserName] = useState('Contractor');
  const [language, setLanguage] = useState<Language>('en');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isDatabaseSetup, setIsDatabaseSetup] = useState(true);
  const [showSetupBanner, setShowSetupBanner] = useState(false);
  const [showCheckModal, setShowCheckModal] = useState(false);

  const t = getTranslation(language);

  // Register service worker for PWA functionality
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Check database setup status
  useEffect(() => {
    const checkSetup = async () => {
      const isSetup = await checkDatabaseSetup();
      setIsDatabaseSetup(isSetup);
      
      // Show banner if database is not set up and user hasn't dismissed it
      const dismissed = localStorage.getItem('setup-banner-dismissed');
      if (!isSetup && !dismissed) {
        setShowSetupBanner(true);
      }
    };
    
    if (user) {
      checkSetup();
    }
  }, [user]);

  // Save preferences to database when they change
  useEffect(() => {
    if (user && isDatabaseSetup) {
      const savePreferences = async () => {
        try {
          await updateUserPreferences(user.id, {
            userName,
            language,
            theme,
          });
        } catch (error) {
          // Silently fail if database isn't set up - this is expected
          // User will see the setup banner and can set it up later
        }
      };
      
      // Debounce the save to avoid too many API calls
      const timeoutId = setTimeout(savePreferences, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [userName, language, theme, user, isDatabaseSetup]);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const supabase = createClient();
        const { data: { session }, error } = await supabase.auth.getSession();

        if (session?.access_token && !error) {
          setAccessToken(session.access_token);
          setUser(session.user);
          if (session.user.user_metadata?.name) {
            setUserName(session.user.user_metadata.name);
          }

          // Load user data from database
          await loadUserData(session.user.id);
        }
      } catch (error) {
        console.error('Error checking session:', error);
      } finally {
        setAuthLoading(false);
      }
    };

    checkSession();
  }, []);

  // Load user data from database
  const loadUserData = async (userId: string) => {
    try {
      // Load transactions
      const transactionsData = await getTransactions(userId);
      setTransactions(transactionsData);

      // Load sites
      const sitesData = await getSites(userId);
      setSites(sitesData);

      // Load user preferences
      const preferences = await getUserPreferences(userId);
      if (preferences) {
        if (preferences.userName) setUserName(preferences.userName);
        if (preferences.language) setLanguage(preferences.language as Language);
        if (preferences.theme) setTheme(preferences.theme as 'light' | 'dark');
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  // Handle login
  const handleLogin = async (email: string, password: string) => {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error(error.message);
    }

    if (data.session) {
      setAccessToken(data.session.access_token);
      setUser(data.user);
      if (data.user.user_metadata?.name) {
        setUserName(data.user.user_metadata.name);
      }

      // Load user data from database
      await loadUserData(data.user.id);
    }
  };

  // Handle signup
  const handleSignup = async (email: string, password: string, name: string) => {
    try {
      // Call the server signup endpoint
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-ca7a0ab6/signup`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({ email, password, name }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Signup failed');
      }

      // After successful signup, automatically log in
      await handleLogin(email, password);
    } catch (error: any) {
      throw new Error(error.message || 'Signup failed');
    }
  };

  // Handle logout
  const handleLogout = async () => {
    if (confirm(t.logoutConfirm)) {
      try {
        const supabase = createClient();
        await supabase.auth.signOut();
        
        setUser(null);
        setAccessToken(null);
        setTransactions([]);
        setSites([]);
        setActiveView('home');
        setUserName('Contractor');
      } catch (error) {
        console.error('Error logging out:', error);
      }
    }
  };

  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className={`min-h-screen ${theme === 'dark' ? 'bg-gray-950' : 'bg-gray-50'} flex items-center justify-center`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>Loading...</p>
        </div>
      </div>
    );
  }

  // Show auth screens if not authenticated
  if (!user || !accessToken) {
    if (authView === 'login') {
      return (
        <LoginScreen
          language={language}
          theme={theme}
          onLogin={handleLogin}
          onSwitchToSignup={() => setAuthView('signup')}
          onLanguageChange={setLanguage}
          onThemeChange={setTheme}
        />
      );
    } else {
      return (
        <SignupScreen
          language={language}
          theme={theme}
          onSignup={handleSignup}
          onSwitchToLogin={() => setAuthView('login')}
          onLanguageChange={setLanguage}
          onThemeChange={setTheme}
        />
      );
    }
  }

  // Main app content (when authenticated)
  const handleAddTransaction = async (transaction: Omit<Transaction, 'id'>) => {
    try {
      if (editingTransaction) {
        // Update existing transaction in database
        const updated = await dbUpdateTransaction(user.id, editingTransaction.id, transaction);
        setTransactions(transactions.map(t => 
          t.id === editingTransaction.id ? updated : t
        ));
        setEditingTransaction(null);
      } else {
        // Add new transaction to database
        const newTransaction = await dbAddTransaction(user.id, transaction);
        setTransactions([newTransaction, ...transactions]);
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error saving transaction:', error);
      alert('Failed to save transaction. Please try again.');
    }
  };

  const handleAddSite = async (site: { name: string; budget: number }) => {
    try {
      const newSite = await dbAddSite(user.id, site);
      setSites([...sites, newSite]);
      setIsSiteModalOpen(false);
    } catch (error) {
      console.error('Error adding site:', error);
      alert('Failed to add site. Please try again.');
    }
  };

  const handleEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setIsModalOpen(true);
  };

  const handleDeleteTransaction = async (id: string) => {
    if (confirm(t.deleteConfirm)) {
      try {
        await dbDeleteTransaction(user.id, id);
        setTransactions(transactions.filter(t => t.id !== id));
      } catch (error) {
        console.error('Error deleting transaction:', error);
        alert('Failed to delete transaction. Please try again.');
      }
    }
  };

  const handleDeleteSite = async (id: string) => {
    if (confirm(t.deleteSiteConfirm)) {
      try {
        await dbDeleteSite(user.id, id);
        setSites(sites.filter(s => s.id !== id));
      } catch (error) {
        console.error('Error deleting site:', error);
        alert('Failed to delete site. Please try again.');
      }
    }
  };

  const totalIn = transactions.filter(t => t.type === 'in').reduce((sum, t) => sum + t.amount, 0);
  const totalOut = transactions.filter(t => t.type === 'out').reduce((sum, t) => sum + t.amount, 0);

  const isDark = theme === 'dark';

  return (
    <div className={`min-h-screen ${isDark ? 'bg-gray-950' : 'bg-gray-50'}`}>
      {/* Portrait-only warning for landscape mode */}
      <div className="portrait-only-warning">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        <h2 className="text-2xl font-bold">Please Rotate Your Device</h2>
        <p className="text-gray-300">This app is designed for portrait mode only</p>
      </div>

      <div className={`max-w-md mx-auto relative ${isDark ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <Header language={language} theme={theme} userName={userName} />
        
        <main className="px-6 pb-24">{/*Removed min-h-screen from parent div, content will naturally expand */}
          {activeView === 'home' && (
            <>
              <BalanceDisplay totalIn={totalIn} totalOut={totalOut} language={language} theme={theme} />
              <QuickActions 
                onAddClick={() => { setEditingTransaction(null); setIsModalOpen(true); }} 
                language={language}
                theme={theme}
              />
              <TransactionsList 
                transactions={transactions.slice(0, 5)} 
                onEdit={handleEditTransaction}
                onDelete={handleDeleteTransaction}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                allTransactions={transactions}
                language={language}
                theme={theme}
              />
            </>
          )}
          
          {activeView === 'history' && (
            <HistoryView 
              transactions={transactions} 
              onEdit={handleEditTransaction}
              onDelete={handleDeleteTransaction}
              language={language}
              theme={theme}
            />
          )}
          
          {activeView === 'settings' && (
            <SettingsScreen 
              userName={userName}
              onUserNameChange={setUserName}
              language={language}
              onLanguageChange={setLanguage}
              theme={theme}
              onThemeChange={setTheme}
              onLogout={handleLogout}
              onNavigateToAbout={() => setActiveView('about')}
            />
          )}

          {activeView === 'about' && (
            <AboutPage 
              onBack={() => setActiveView('settings')}
              language={language}
              theme={theme}
            />
          )}

          {activeView === 'suppliers' && (
            <SuppliersView 
              transactions={transactions}
              onEdit={handleEditTransaction}
              onDelete={handleDeleteTransaction}
              language={language}
              theme={theme}
            />
          )}

          {activeView === 'sites' && (
            <SitesView 
              sites={sites} 
              transactions={transactions} 
              onDeleteSite={handleDeleteSite}
              onAddSite={() => setIsSiteModalOpen(true)}
              language={language}
              theme={theme}
            />
          )}
        </main>

        {activeView !== 'about' && (
          <TabBar activeView={activeView} onViewChange={setActiveView} language={language} theme={theme} />
        )}

        {isModalOpen && (
          <AddTransactionModal
            onClose={() => {
              setIsModalOpen(false);
              setEditingTransaction(null);
            }}
            onSubmit={handleAddTransaction}
            editingTransaction={editingTransaction}
            language={language}
            theme={theme}
          />
        )}

        {isSiteModalOpen && (
          <AddSiteModal
            onClose={() => setIsSiteModalOpen(false)}
            onSubmit={handleAddSite}
            language={language}
            theme={theme}
          />
        )}

        {showSetupBanner && (
          <DatabaseSetupBanner
            onClose={() => {
              setShowSetupBanner(false);
              localStorage.setItem('setup-banner-dismissed', 'true');
            }}
            onCheckDatabase={() => setShowCheckModal(true)}
            language={language}
            theme={theme}
          />
        )}

        {showCheckModal && user && (
          <DatabaseCheckModal
            onClose={() => setShowCheckModal(false)}
            userId={user.id}
            theme={theme}
          />
        )}
      </div>
    </div>
  );
}