function PrivacyNinja(){}

PrivacyNinja.prototype = {
    _os: null, // Observer service
    _ps: null, // Pref service
    _inPrivateBrowsing: false, // whether we are in private browsing mode
    _watcher: null, // the watcher object
    process: null, // tunnel process
    
    init: function() {
        this._inited = true;
        this._os = Components.classes["@mozilla.org/observer-service;1"]
                            .getService(Components.interfaces.nsIObserverService);
        this._os.addObserver(this, "private-browsing", false);
        this._os.addObserver(this, "quit-application", false);
        try {
            var pbs = Components.classes["@mozilla.org/privatebrowsing;1"]
                            .getService(Components.interfaces.nsIPrivateBrowsingService);
            this._inPrivateBrowsing = pbs.privateBrowsingEnabled;
        } catch(ex) {
            // ignore exceptions in older versions of Firefox
        }
        this._ps = Components.classes["@mozilla.org/preferences-service;1"]
                            .getService(Components.interfaces.nsIPrefService);
        
        this.setDefaults();
        
        var parent = this;
        this._watcher = {
            onEnterPrivateBrowsing : function() {
                let pref = parent._ps.getBranch('');
                
                // we have just entered private browsing mode!
                parent.saveDefaultProxySettings();
                
                if(pref.getBoolPref('extensions.privacyninja.use_tunnel')) {
                    parent.startTunnel();
                    pref.setCharPref('network.proxy.http', '127.0.0.1');
                    pref.setIntPref('network.proxy.http_port', pref.getIntPref('extensions.privacyninja.local_port'));
                    pref.setIntPref('network.proxy.type', 1);
                }
                else {
                    pref.setCharPref('network.proxy.http', pref.getCharPref('extensions.privacyninja.proxy_host'));
                    pref.setIntPref('network.proxy.http_port', pref.getIntPref('extensions.privacyninja.proxy_port'));
                    pref.setIntPref('network.proxy.type', 1);
                }
                
            },
          
            onExitPrivateBrowsing : function() {
                // we have just left private browsing mode!
                let pref = parent._ps.getBranch('');
                parent.closeTunnel();
                parent.restoreDefaultProxySettings();
            }
        };
    },
    
    shutdown: function() {
        this.restoreDefaultProxySettings();
        if(this.process) {
            this.closeTunnel();
        }
        this._os.removeObserver(this, "private-browsing", false);
        this._os.removeObserver(this, "quit-application", false);
    },
    
    setDefaults: function() {
        let dpref = this._ps.getDefaultBranch('extensions.privacyninja.')
        dpref.setIntPref("proxy_port", 8080);
        dpref.setIntPref("local_port", 4888);
        dpref.setCharPref("proxy_host", "");
        dpref.setBoolPref("use_tunnel", false);
        //dpref.setComplexValue("tunnel_executable", Components.interfaces.nsIFile, null);
        
        //dpref.setCharPref("tunnel_executable", "C:\\Users\\matt\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\gd370pcy.dev\\plink.exe");
        dpref.setCharPref("tunnel_executable", "C:\\plink.exe");
        dpref.setCharPref("tunnel_args", "-ssh -N -L $local_port:127.0.0.1:$proxy_port -l $username -pw $password $proxy_host");
        
        // TODO: Move these to password vault
        dpref.setCharPref("username", "");
        dpref.setCharPref("password", "");
        
    },
    
    startTunnel: function() {
        //Components.utils.import("resource://gre/modules/FileUtils.jsm");
        // get the "data.txt" file in the profile directory
        //var file = FileUtils.getFile("ProfD", ["plink.exe"]);
        
        let pref = this._ps.getBranch('extensions.privacyninja.');
        
        var file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
        file.initWithPath(pref.getCharPref("tunnel_executable"));
        
        
        this.process = Components.classes["@mozilla.org/process/util;1"]
                    .createInstance(Components.interfaces.nsIProcess);
        
        var arg_map = {
            '$local_port': pref.getIntPref('local_port'),
            '$proxy_port': pref.getIntPref('proxy_port'),
            '$proxy_host': pref.getCharPref('proxy_host'),
            '$username': pref.getCharPref('username'),
            '$password': pref.getCharPref('password'),
        },
        
        args = pref.getCharPref("tunnel_args").split(" ");
        for(let i = 0; i < args.length; i++) {
            for (name in arg_map) {
                args[i] = args[i].replace(name, arg_map[name]);
            }
        }
        
        this.process.init(file);
        this.process.run(false, args, args.length);
        
        //this.refocus();
    },
    
    closeTunnel: function() {
        this.process.kill();
    },
    
    //refocus: function() {
    //    let wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
    //                     .getService(Components.interfaces.nsIWindowMediator);
    //    let win = wm.getMostRecentWindow("navigator:browser");
    //    //let domWindowUtils = window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
    //    //             .getInterface(Components.interfaces.nsIDOMWindowUtils);
    //    //win.setTimeout(function() {domWindowUtils.focus(win);}, 300);
    //    //win.setTimeout(function() {win.blur(); win.focus();}, 300);
    //},
    
    saveDefaultProxySettings: function() {
        if(this.hasSavedProxySettings()) {
            return;
        }
        let pref = this._ps.getBranch('');
        pref.setIntPref('extensions.privacyninja.defaults.proxy_type', pref.getIntPref('network.proxy.type'));
        pref.setCharPref('extensions.privacyninja.defaults.proxy_http', pref.getCharPref('network.proxy.http'));
        pref.setIntPref('extensions.privacyninja.defaults.proxy_http_port', pref.getIntPref('network.proxy.http_port'));
    },
    
    restoreDefaultProxySettings: function() {
        let pref = this._ps.getBranch('');
        if(pref.prefHasUserValue('extensions.privacyninja.defaults.proxy_type'))
            pref.setIntPref('network.proxy.type', pref.getIntPref('extensions.privacyninja.defaults.proxy_type'));
        if(pref.prefHasUserValue('extensions.privacyninja.defaults.proxy_http'))
            pref.setCharPref('network.proxy.http', pref.getCharPref('extensions.privacyninja.defaults.proxy_http'));
        if(pref.prefHasUserValue('extensions.privacyninja.defaults.proxy_http_port'))
            pref.setIntPref('network.proxy.http_port', pref.getIntPref('extensions.privacyninja.defaults.proxy_http_port'));
        pref.clearUserPref('extensions.privacyninja.defaults.proxy_type');
        pref.clearUserPref('extensions.privacyninja.defaults.proxy_http');
        pref.clearUserPref('extensions.privacyninja.defaults.proxy_http_port');
    },
    
    hasSavedProxySettings: function() {
        let pref = this._ps.getBranch('extensions.privacyninja.defaults.');
        return pref.prefHasUserValue('proxy_type') ||
               pref.prefHasUserValue('proxy_http') ||
               pref.prefHasUserValue('proxy_http_port');
    },
    
    
    observe: function (aSubject, aTopic, aData) {
        if (aTopic == "private-browsing") {
            if (aData == "enter") {
                this._inPrivateBrowsing = true;
                if (this.watcher &&
                        "onEnterPrivateBrowsing" in this._watcher) {
                    this.watcher.onEnterPrivateBrowsing();
                }
            } else if (aData == "exit") {
                this._inPrivateBrowsing = false;
                if (this.watcher &&
                        "onExitPrivateBrowsing" in this._watcher) {
                    this.watcher.onExitPrivateBrowsing();
                }
            }
        } else if (aTopic == "quit-application") {
            this.watcher.onExitPrivateBrowsing();
            this._os.removeObserver(this, "quit-application");
            this._os.removeObserver(this, "private-browsing");
        }
    },
  
    get inPrivateBrowsing() {
        return this._inPrivateBrowsing;
    },
    
    get watcher() {
        return this._watcher;
    },
    
    set watcher(val) {
        this._watcher = val;
    }
}


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

function install(data, reason) {}

function uninstall(data, reason) {}
