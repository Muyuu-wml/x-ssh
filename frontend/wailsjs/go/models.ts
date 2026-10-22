export namespace main {
	
	export class AppInfo {
	    version: string;
	    dataDir: string;
	    keySource: string;
	    profilePath: string;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.dataDir = source["dataDir"];
	        this.keySource = source["keySource"];
	        this.profilePath = source["profilePath"];
	    }
	}

}

export namespace model {
	
	export class FileEntry {
	    name: string;
	    path: string;
	    size: number;
	    mode: string;
	    isDir: boolean;
	    isLink: boolean;
	    modTime: string;
	    modUnix: number;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.mode = source["mode"];
	        this.isDir = source["isDir"];
	        this.isLink = source["isLink"];
	        this.modTime = source["modTime"];
	        this.modUnix = source["modUnix"];
	    }
	}
	export class Group {
	    id: string;
	    name: string;
	    parentId: string;
	    order: number;
	
	    static createFrom(source: any = {}) {
	        return new Group(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.parentId = source["parentId"];
	        this.order = source["order"];
	    }
	}
	export class Host {
	    id: string;
	    name: string;
	    groupId: string;
	    address: string;
	    port: number;
	    username: string;
	    authType: string;
	    order: number;
	    password: string;
	    privateKey: string;
	    passphrase: string;
	    tags: string[];
	    distro?: string;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	    // Go type: time
	    lastUsedAt?: any;
	
	    static createFrom(source: any = {}) {
	        return new Host(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.groupId = source["groupId"];
	        this.address = source["address"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authType = source["authType"];
	        this.order = source["order"];
	        this.password = source["password"];
	        this.privateKey = source["privateKey"];
	        this.passphrase = source["passphrase"];
	        this.tags = source["tags"];
	        this.distro = source["distro"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	        this.lastUsedAt = this.convertValues(source["lastUsedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Profile {
	    version: number;
	    groups: Group[];
	    hosts: Host[];
	
	    static createFrom(source: any = {}) {
	        return new Profile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.groups = this.convertValues(source["groups"], Group);
	        this.hosts = this.convertValues(source["hosts"], Host);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace sftpx {
	
	export class TaskView {
	    id: string;
	    sessionId: string;
	    kind: string;
	    name: string;
	    file: string;
	    status: string;
	    done: number;
	    total: number;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new TaskView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.file = source["file"];
	        this.status = source["status"];
	        this.done = source["done"];
	        this.total = source["total"];
	        this.error = source["error"];
	    }
	}

}

export namespace sshx {
	
	export class Info {
	    id: string;
	    hostId: string;
	    title: string;
	    address: string;
	    status: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.hostId = source["hostId"];
	        this.title = source["title"];
	        this.address = source["address"];
	        this.status = source["status"];
	        this.error = source["error"];
	    }
	}

}

export namespace store {
	
	export class ImportSummary {
	    hostsAdded: number;
	    hostsUpdated: number;
	    groupsAdded: number;
	    groupsUpdated: number;
	
	    static createFrom(source: any = {}) {
	        return new ImportSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hostsAdded = source["hostsAdded"];
	        this.hostsUpdated = source["hostsUpdated"];
	        this.groupsAdded = source["groupsAdded"];
	        this.groupsUpdated = source["groupsUpdated"];
	    }
	}

}

