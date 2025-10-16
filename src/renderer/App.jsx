import React, { useState, useEffect } from 'react'
import { useAppStore } from './store/app-store'
import AccountManager from './components/AccountManager'
import BatchProcessor from './components/BatchProcessor'
import ProgressMonitor from './components/ProgressMonitor'
import SettingsPanel from './components/SettingsPanel'

function App() {
  const [activeTab, setActiveTab] = useState('accounts')
  const [appInfo, setAppInfo] = useState({ version: '', platform: '' })
  const { isInitialized, initialize } = useAppStore()

  useEffect(() => {
    const initApp = async () => {
      try {
        const version = await window.electronAPI.getVersion()
        const platform = await window.electronAPI.getPlatform()
        setAppInfo({ version, platform })
        
        await initialize()
        console.log(`VEO3 Automation Tool v${version} running on ${platform}`)
      } catch (error) {
        console.error('Failed to initialize app:', error)
      }
    }

    initApp()
  }, [initialize])

  const tabs = [
    { id: 'accounts', label: 'Accounts', component: AccountManager },
    { id: 'batch', label: 'Batch Processing', component: BatchProcessor },
    { id: 'progress', label: 'Progress', component: ProgressMonitor },
    { id: 'settings', label: 'Settings', component: SettingsPanel }
  ]

  const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component

  if (!isInitialized) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Initializing VEO3 Automation Tool...</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>VEO3 Automation Tool</h1>
        <p>Automate video generation with Chrome profiles</p>
        <div className="app-info">
          v{appInfo.version} • {appInfo.platform}
        </div>
      </header>

      <nav className="app-nav">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {ActiveComponent && <ActiveComponent />}
      </main>
    </div>
  )
}

export default App