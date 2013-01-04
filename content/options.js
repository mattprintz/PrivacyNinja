Components.utils.import("resource://gre/modules/Services.jsm");

function browse(targetID) {
    let fp = Components.classes["@mozilla.org/filepicker;1"]
                     .createInstance(Components.interfaces.nsIFilePicker);
    let elem = document.getElementById(targetID);
    fp.show();
    elem.value = fp.file.path;
}

function loadPassword() {
    let loginManager = Services.logins;
    let logins = loginManager.findLogins({}, "chrome://privacyninja", null, "ssh_tunnel");
    if (logins.length > 0) {
        document.getElementById('opt-username').value = logins[0].username;
        document.getElementById('opt-password').value = logins[0].password;
    }
    
}

function setuser(username) {
    let loginManager = Services.logins;
    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
    let logins = loginManager.findLogins({}, "chrome://privacyninja", null, "ssh_tunnel");
    if (logins.length > 0) {
        let loginInfo = new nsLoginInfo("chrome://privacyninja", null, "ssh_tunnel", username, logins[0].password, "", "");
        loginManager.modifyLogin(logins[0], loginInfo);
    }
    else {
        let loginInfo = new nsLoginInfo("chrome://privacyninja", null, "ssh_tunnel", username, "\b", "", "");
        loginManager.addLogin(loginInfo);
    }
}

function setpass(password) {
    let loginManager = Services.logins;
    let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
    let logins = loginManager.findLogins({}, "chrome://privacyninja", null, "ssh_tunnel");
    if (logins.length > 0) {
        let loginInfo = new nsLoginInfo("chrome://privacyninja", null, "ssh_tunnel", logins[0].username, password, "", "");
        loginManager.modifyLogin(logins[0], loginInfo);
    }
    else {
        let loginInfo = new nsLoginInfo("chrome://privacyninja", null, "ssh_tunnel", "\b", password, "", "");
        loginManager.addLogin(loginInfo);
    }
}