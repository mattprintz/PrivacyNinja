const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Components.utils.import("resource://gre/modules/Services.jsm");

function alert(string) {
    let wm = Services.wm;
    let win = wm.getMostRecentWindow("navigator:browser");
    if(win)
        win.alert(string);
}

var privacyninja_ww = {
    
    watchWindows: function(loadCallback) {
        // Wrap the callback in a function that ignores failures
        function watcher(window) {
            try {
                // Now that the window has loaded, only handle browser windows
                let {documentElement} = window.document;
                if (documentElement.getAttribute("windowtype") == "navigator:browser") {
                    loadCallback(window);
                }
            }
            catch(ex) {}
        }
    
        // Wait for the window to finish loading before running the callback
        function runOnLoad(window) {
            // Listen for one load event before checking the window type
            window.addEventListener("load", function runOnce() {
                window.removeEventListener("load", runOnce, false);
                watcher(window);
            }, false);
        }
    
        // Add functionality to existing windows
        let windows = Services.wm.getEnumerator(null);
        while (windows.hasMoreElements()) {
            // Only run the watcher immediately if the window is completely loaded
            let window = windows.getNext();
            if (window.document.readyState == "complete")
                watcher(window);
            // Wait for the window to load before continuing
            else
                runOnLoad(window);
        }
    
        // Watch for new browser windows opening then wait for it to load
        function windowWatcher(subject, topic) {
            if (topic == "domwindowopened")
                runOnLoad(subject);
        }
        Services.ww.registerNotification(windowWatcher);
    
        // Make sure to stop watching for windows if we're unloading
        this.unload(function() Services.ww.unregisterNotification(windowWatcher));
    },
    
    unload: function(callback, container) {
        // Initialize the array of unloaders on the first usage
        let unloaders = this.unload.unloaders;
        if (unloaders == null)
            unloaders = this.unload.unloaders = [];
    
        // Calling with no arguments runs all the unloader callbacks
        if (callback == null) {
            unloaders.slice().forEach(function(unloader) unloader());
            unloaders.length = 0;
            return null;
        }
    
        // The callback is bound to the lifetime of the container if we have one
        if (container != null) {
            // Remove the unloader when the container unloads
            container.addEventListener("unload", removeUnloader, false);
    
            // Wrap the callback to additionally remove the unload listener
            let origCallback = callback;
            callback = function() {
                container.removeEventListener("unload", removeUnloader, false);
                origCallback();
            }
        }
    
        // Wrap the callback in a function that ignores failures
        function unloader() {
            try {
                callback();
            }
            catch(ex) {}
        }
        unloaders.push(unloader);
    
        // Provide a way to remove the unloader
        function removeUnloader() {
            let index = unloaders.indexOf(unloader);
            if (index != -1)
                unloaders.splice(index, 1);
        }
        return removeUnloader;
    }
    
};

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
        this._os = Services.obs;
        this._os.addObserver(this, "private-browsing", false);
        this._os.addObserver(this, "quit-application", false);
        
        this._inPrivateBrowsing = Components.classes["@mozilla.org/privatebrowsing;1"].
                                  getService(Components.interfaces.nsIPrivateBrowsingService).
                                  privateBrowsingEnabled;
        
        this._ps = Services.prefs;
        
        this._osType = Services.appinfo.OS;
        
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
        
        // Remove menuitems
        let windows = Services.wm.getEnumerator(null);
        while (windows.hasMoreElements()) {
            // Only run the watcher immediately if the window is completely loaded
            let window = windows.getNext();
            let menuItem = window.document.getElementById("privacyninja_options_menuitem");
            if (menuItem)
                menuItem.parentNode.removeChild(menuItem);
        }
        
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
        let loginManager = Services.logins;
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
        let loginManager = Services.logins;
        let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
        let loginInfo = new nsLoginInfo(this.PASSDOM, null, "ssh_tunnel", username, password, "", "");
        loginManager.addLogin(loginInfo);
    },
    
    onWindow: function(win) {
        let document = win.document;
        let toolsMenu = document.getElementById("menu_ToolsPopup");
        let pnMenuItem = document.createElement("menuitem");
        pnMenuItem.setAttribute("id", "privacyninja_options_menuitem");
        pnMenuItem.setAttribute("label", "PrivacyNinja Options");
        pnMenuItem.addEventListener("command", function(){
            win.open('chrome://privacyninja/content/options.xul', 'privacyninja_options', 'chrome,resizable=true');
        }, false);
        toolsMenu.appendChild(pnMenuItem);
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
    },
  
    get inPrivateBrowsing() {
        return this._inPrivateBrowsing;
    },
}

// Define global PrivacyNinja instance
var privacyninja = new PrivacyNinja();

function startup(data, reason) {
    privacyninja.init();
    privacyninja_ww.watchWindows(privacyninja.onWindow);
    if(privacyninja.hasSavedProxySettings()) {
        privacyninja.restoreDefaultProxySettings();
    }
}

function shutdown(data, reason) {
    if(privacyninja.hasSavedProxySettings()) {
        privacyninja.restoreDefaultProxySettings();
    }
    try{
    privacyninja_ww.unload();
    privacyninja.shutdown();
    } catch(e) {alert(e)}
}

// Unused
function install(data, reason) {
    //TODO: Display config wizard in tab
}

// Unused
function uninstall(data, reason) {}
