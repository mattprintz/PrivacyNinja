function alert(string) {
    let wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                     .getService(Components.interfaces.nsIWindowMediator);
    let win = wm.getMostRecentWindow("navigator:browser");
    if(win)
        win.alert(string);
}

//Components.utils.import("resource://gre/modules/Services.jsm");

function PrivacyNinja(){}
PrivacyNinja.prototype = {
    PASSDOM: "chrome://privacyninja", // Password domain
    
    _osType: null, // What OS is this running
    _os: null, // Observer service
    _ps: null, // Pref service
    _inPrivateBrowsing: false, // whether we are in private browsing mode
    process: null, // tunnel process
    
    init: function() {
        this._inited = true;
        this._os = Components.classes["@mozilla.org/observer-service;1"]
                            .getService(Components.interfaces.nsIObserverService);
        this._os.addObserver(this, "private-browsing", false);
        this._os.addObserver(this, "quit-application", false);
        
        this._inPrivateBrowsing = Components.classes["@mozilla.org/privatebrowsing;1"].
                                  getService(Components.interfaces.nsIPrivateBrowsingService).
                                  privateBrowsingEnabled;
        
        this._ps = Components.classes["@mozilla.org/preferences-service;1"]
                            .getService(Components.interfaces.nsIPrefService);
        
        var xulRuntime = Components.classes["@mozilla.org/xre/app-info;1"]
                    .getService(Components.interfaces.nsIXULRuntime);
        this._osType = xulRuntime.OS;
        
        this.setDefaults();
    },
    
    onEnterPrivateBrowsing : function() {
        let pref = this._ps.getBranch("");
        
        // we have just entered private browsing mode!
        this.saveDefaultProxySettings();
        
        if(pref.getBoolPref("extensions.privacyninja.use_tunnel")) {
            this.startTunnel();
            pref.setCharPref("network.proxy.http", "127.0.0.1");
            pref.setIntPref("network.proxy.http_port", pref.getIntPref("extensions.privacyninja.local_port"));
            pref.setIntPref("network.proxy.type", 1);
        }
        else {
            pref.setCharPref("network.proxy.http", pref.getCharPref("extensions.privacyninja.proxy_host"));
            pref.setIntPref("network.proxy.http_port", pref.getIntPref("extensions.privacyninja.proxy_port"));
            pref.setIntPref("network.proxy.type", 1);
        }
        
    },
    
    onExitPrivateBrowsing : function() {
        // we have just left private browsing mode!
        this.closeTunnel();
        this.restoreDefaultProxySettings();
    },
    
    shutdown: function() {
        if(this.process) {
            this.closeTunnel();
        }
        this.restoreDefaultProxySettings();
        this._os.removeObserver(this, "private-browsing", false);
        this._os.removeObserver(this, "quit-application", false);
    },
    
    setDefaults: function() {
        Components.utils.import("resource://gre/modules/FileUtils.jsm");
        
        let dpref = this._ps.getDefaultBranch("extensions.privacyninja.")
        dpref.setIntPref("proxy_port", 8080);
        dpref.setIntPref("local_port", 4080);
        dpref.setCharPref("proxy_host", "");
        dpref.setBoolPref("use_tunnel", false);
        
        dpref.setComplexValue("tunnel_keyfile", Components.interfaces.nsIFile, FileUtils.getFile("Home", ["tunnel.key"]));        
        
        // Windows
        if (this._osType == "WINNT") {
            dpref.setComplexValue("tunnel_executable", Components.interfaces.nsIFile, FileUtils.getFile("Home", ["plink.exe"]));
            dpref.setCharPref("tunnel_args", "-ssh -N -L $local_port:127.0.0.1:$proxy_port -l $username -i $keyfile $proxy_host");
        }
        
        // Linux/Mac
        else {
            dpref.setComplexValue("tunnel_executable", Components.interfaces.nsIFile, FileUtils.File("/usr/bin/ssh"));
            dpref.setCharPref("tunnel_args", "-L $local_port:127.0.0.1:$proxy_port -l $username -i $keyfile $proxy_host");
        }
        
        // Possible feature?
        //dpref.setBoolPref("enforceChecksumMatch", true);
    },
    
    startTunnel: function() {
        try{
        let pref = this._ps.getBranch("extensions.privacyninja.");
        
        let file = pref.getComplexValue("tunnel_executable", Components.interfaces.nsIFile);
        
        this.process = Components.classes["@mozilla.org/process/util;1"]
                    .createInstance(Components.interfaces.nsIProcess);
        
        let username = "",
            password = "";
        let login = this.getPassword();
        if(login) {
            username = login.user;
            password = login.pass;
        }
        else {
            alert("Need username/password for tunnel");
            return;
        }
        
        var arg_map = {
            "$local_port": pref.getIntPref("local_port"),
            "$proxy_port": pref.getIntPref("proxy_port"),
            "$proxy_host": pref.getCharPref("proxy_host"),
            "$username": username,
            "$password": password,
            "$keyfile": pref.getComplexValue("tunnel_keyfile", Components.interfaces.nsIFile).path,
        },
        
        args = pref.getCharPref("tunnel_args").split(" ");
        for(let i = 0; i < args.length; i++) {
            for (name in arg_map) {
                args[i] = args[i].replace(name, arg_map[name]);
            }
        }
        
        this.process.init(file);
        this.process.run(false, args, args.length);
        
        }catch(e) {
            alert(e);
        }
    },
    
    closeTunnel: function() {
        this.process.kill();
        this.process = null;
    },
    
    saveDefaultProxySettings: function() {
        if(this.hasSavedProxySettings()) {
            return;
        }
        let pref = this._ps.getBranch("");
        pref.setIntPref("extensions.privacyninja.defaults.proxy_type", pref.getIntPref("network.proxy.type"));
        pref.setCharPref("extensions.privacyninja.defaults.proxy_http", pref.getCharPref("network.proxy.http"));
        pref.setIntPref("extensions.privacyninja.defaults.proxy_http_port", pref.getIntPref("network.proxy.http_port"));
    },
    
    restoreDefaultProxySettings: function() {
        let pref = this._ps.getBranch("");
        if(pref.prefHasUserValue("extensions.privacyninja.defaults.proxy_type"))
            pref.setIntPref("network.proxy.type", pref.getIntPref("extensions.privacyninja.defaults.proxy_type"));
        if(pref.prefHasUserValue("extensions.privacyninja.defaults.proxy_http"))
            pref.setCharPref("network.proxy.http", pref.getCharPref("extensions.privacyninja.defaults.proxy_http"));
        if(pref.prefHasUserValue("extensions.privacyninja.defaults.proxy_http_port"))
            pref.setIntPref("network.proxy.http_port", pref.getIntPref("extensions.privacyninja.defaults.proxy_http_port"));
        pref.clearUserPref("extensions.privacyninja.defaults.proxy_type");
        pref.clearUserPref("extensions.privacyninja.defaults.proxy_http");
        pref.clearUserPref("extensions.privacyninja.defaults.proxy_http_port");
    },
    
    hasSavedProxySettings: function() {
        let pref = this._ps.getBranch("extensions.privacyninja.defaults.");
        return pref.prefHasUserValue("proxy_type") ||
               pref.prefHasUserValue("proxy_http") ||
               pref.prefHasUserValue("proxy_http_port");
    },
    
    getPassword: function() {
        let loginManager = Components.classes["@mozilla.org/login-manager;1"]
                           .getService(Components.interfaces.nsILoginManager);
        let logins = loginManager.findLogins({}, this.PASSDOM, null, "ssh_tunnel");
        if (logins.length > 0) {
            return {
                "user": logins[0].username,
                "pass": logins[0].password
            };
        }
        else {
            return null;
        }
    },
    
    setPassword: function(username, password) {
        let loginManager = Components.classes["@mozilla.org/login-manager;1"]
                           .getService(Components.interfaces.nsILoginManager);
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
        let loginInfo = new nsLoginInfo(this.PASSDOM, null, "ssh_tunnel", username, password, "", "");
        loginManager.addLogin(loginInfo);
    },
    
    observe: function (aSubject, aTopic, aData) {
        if (aTopic == "private-browsing") {
            if (aData == "enter") {
                this._inPrivateBrowsing = true;
                this.onEnterPrivateBrowsing();
            } else if (aData == "exit") {
                this._inPrivateBrowsing = false;
                this.onExitPrivateBrowsing();
            }
        }
        else if (aTopic == "quit-application") {
            this.shutdown();
        }
        else if (aTopic == "domwindowopened") {
            // TODO: Add way to open optiosn from dom windows
        }
    },
  
    get inPrivateBrowsing() {
        return this._inPrivateBrowsing;
    },
}

// Define global PrivacyNinja instance
var privacyninja = new PrivacyNinja();

function startup(data, reason) {
    privacyninja.init();
    if(privacyninja.hasSavedProxySettings()) {
        privacyninja.restoreDefaultProxySettings();
    }
}

function shutdown(data, reason) {
    if(privacyninja.hasSavedProxySettings()) {
        privacyninja.restoreDefaultProxySettings();
    }
    privacyninja.shutdown();
}

// Unused
function install(data, reason) {}

// Unused
function uninstall(data, reason) {}
