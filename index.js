const fetch = require('node-fetch');
const EventSource = require('eventsource')
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-petnet", "petnet", petnet, true);
}

function petnet(log, config, api) {
    this.log = log;
    this.config = config;
    this.accessories = [];
    this.timers = {};


    this.app_token = this.config.app_token ? this.config.app_token : "3Ei86ExIh6USKcuMJMrPgg==";
    this.api_url = this.config.api_url ? this.config.api_url : "https://m-api570.petnet.io";
    this.app_version = this.config.app_version ? this.config.app_version : "5.7.4";

    if (api) {
        this.api = api;
        this.api.on('didFinishLaunching', this.fetchDevices.bind(this));
    }
}

petnet.prototype.configureAccessory = function(accessory) {
    this.getInitState(accessory);
    this.accessories.push(accessory);
}

petnet.prototype.authorize = function() {
    return fetch(this.api_url + '/tokens?app_token=' + this.app_token, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json;version=' + this.app_version,
            }
        })
        .then(res => res.json())
        .then(json => {
        this.log(json);
            this.firebase_url = json.tokens.firebase.url;
            this.firebase_token = json.tokens.firebase.token;
            var login = {
                user: {
                    email: this.config.username,
                    password: this.config.password
                }
            };
            return fetch(this.api_url + '/session?app_token=' + this.app_token, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json;version=' + this.app_version
                },
                body: JSON.stringify(login)
            })
        })
        .then(res => {
            this.api_cookie = res.headers.get('set-cookie').split(';')[0];
            return res.json();
        })
        .then(json => {
        this.log(json);
            if (json.success) {
                this.api_token = json.api_token;
            } else {
                this.api_token = null;
                this.api_cookie = null;
            }
        });
}

petnet.prototype.fetchDevices = function() {
    this.authorize()
        .then(() => {
            return fetch(this.api_url + '/user/devices?app_token=' + this.app_token + '&api_token=' + this.api_token, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json;version=' + this.app_version,
                    'Cookie': this.api_cookie
                }
            })
        })
        .then(res => res.json())
        .then(json => {
            var newIDs = [];

            if (json.status == 'ok') {
                json.devices.forEach(device => {
                    this.addAccessory(device.device);
                    newIDs.push(device.device.id);
                })
            }

            var badAccessories = [];
            this.accessories.forEach(cachedAccessory => {
                if (!newIDs.includes(cachedAccessory.context.id)) {
                    badAccessories.push(cachedAccessory);
                }
            });
            this.removeAccessories(badAccessories);
        })
        .catch(error => {
            this.log(error);
        });
}

/*petnet.prototype.fetchData = function(accessory) {
    fetch(this.api_url + '/user/devices?app_token=' + this.app_token + '&api_token=' + this.api_token, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json;version=' + this.app_version,
                    'Cookie': this.api_cookie
                }
            })
        .then(res => res.json())
        .then(json => {
            var newIDs = [];

            if (json.status == 'ok') {
                json.devices.forEach(device => {
                    this.addAccessory(device.device);
                    newIDs.push(device.device.id);
                })
            }

            var badAccessories = [];
            this.accessories.forEach(cachedAccessory => {
                if (!newIDs.includes(cachedAccessory.context.id)) {
                    badAccessories.push(cachedAccessory);
                }
            });
            this.removeAccessories(badAccessories);
        })
        .catch(error => {
            this.log(error);
        });
}*/

petnet.prototype.feed = function(accessory, state, callback) {
    if (state) {
        var feed = {
            portion: this.config.feed_cups
        }
        //this.log(this.api_cookie);
        //this.log(JSON.stringify(feed));
        this.log(accessory.context.status_url);
        this.log(this.firebase_url);
        this.log(accessory.context.status_url + '/mobile/commands/feed.json?auth=' + this.firebase_token);
        fetch(accessory.context.status_url + '/mobile/commands/feed.json?auth=' + this.firebase_token, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                //body: JSON.stringify(feed)
                body: '{"portion": ' + this.config.feed_cups + "}"
            })
            .then(res => {
                if (res.ok) {
                    this.log(accessory.context.name + ' feeding successful')
                    callback();
                } else {
                    callback(res.statusText);
                }
                return res.text();
            })
            .then(text => this.log(text))
            .catch(error => {
                callback(error);
            }).
        finally(() => {
            setTimeout(() => {
                accessory.getService(Service.Switch).updateCharacteristic(Characteristic.On, false)
            }, 1000);
        });
    } else {
        callback();
    }
}

petnet.prototype.addAccessory = function(device) {
    var accessory;
    this.accessories.forEach(cachedAccessory => {
        if (cachedAccessory.context.id == device.id) {
            accessory = cachedAccessory;
        }
    });

    if (!accessory) {
        var uuid = UUIDGen.generate(device.id);

        accessory = new Accessory(device.name, uuid);

        accessory.context = device;

        accessory.addService(Service.Switch, device.name);
        //accessory.addService(Service.BatteryService, device.name);

        this.configureAccessory(accessory);

        this.api.registerPlatformAccessories("homebridge-petnet", "petnet", [accessory]);
    } else {
        accessory.context = device;
    }
}

petnet.prototype.getInitState = function(accessory) {
    this.log('Init');
    accessory.on('identify', (paired, callback) => {
        this.log(accessory.context.name + " identify requested!");
        callback();
    });

    accessory.getService(Service.Switch).getCharacteristic(Characteristic.On)
        .on('set', this.feed.bind(this, accessory));
    /*.on('get', callback => {
        this.fetchData(accessory);
        callback();
    });*/

    //this.fetchData(accessory);
    //this.log(accessory.context.status_url + '.json?auth=' + this.firebase_token);

    accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Name, accessory.context.name)
        .setCharacteristic(Characteristic.Manufacturer, "Petnet")
        .setCharacteristic(Characteristic.Model, accessory.context.type)
        .setCharacteristic(Characteristic.SerialNumber, accessory.context.serial_number);

    accessory.updateReachability(accessory.context.status.online);
}

petnet.prototype.removeAccessories = function(accessories) {
    accessories.forEach(accessory => {
        this.api.unregisterPlatformAccessories("homebridge-petnet", "petnet", [accessory]);
        this.accessories.splice(this.accessories.indexOf(accessory), 1);
    });
}

petnet.prototype.identify = function(accessory, paired, callback) {
    this.log(accessory.context.config.name + "identify requested!");
    callback();
}