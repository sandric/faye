JS.ENV.ClientSpec = JS.Test.describe("Client", function() { with(this) {
  before(function() { with(this) {
    this.transport = {connectionType: "fake", send: function() {}}
    stub(Faye.Transport, "get").yields([transport])
  }})

  define("stubResponse", function(response) { with(this) {
    stub(transport, "send", function(message) {
      response.id = message.id
      client.receiveMessage(response)
    })
  }})

  define("createClient", function() { with(this) {
    this.client = new Faye.Client("http://localhost/")
  }})
  
  define("createConnectedClient", function() { with(this) {
    createClient()
    stubResponse({channel:    "/meta/handshake",
                  successful: true,
                  version:    "1.0",
                  supportedConnectionTypes: ["websocket"],
                  clientId:   "fakeid" })
    
    client.handshake()
  }})
  
  define("subscribe", function(client, channel, callback) { with(this) {
    stubResponse({channel:      "/meta/subscribe",
                  successful:   true,
                  clientId:     "fakeid",
                  subscription: channel })
    
    this.subsCalled = 0
    callback = callback || function() { subsCalled += 1 }
    client.subscribe(channel, callback)
  }})

  describe("initialize", function() { with(this) {
    it("creates a transport the server must support", function() { with(this) {
      expect(Faye.Transport, "get").given(instanceOf(Faye.Client),
                                          ["long-polling", "callback-polling", "in-process"])
                                   .yielding([transport])
      new Faye.Client("http://localhost/")
    }})

    it("puts the client in the UNCONNECTED state", function() { with(this) {
      stub(Faye.Transport, "get")
      var client = new Faye.Client("http://localhost/")
      assertEqual( "UNCONNECTED", client.getState() )
    }})
  }})

  describe("handshake", function() { with(this) {
    before(function() { this.createClient() })

    it("sends a handshake message to the server", function() { with(this) {
      expect(transport, "send").given({
        channel:  "/meta/handshake",
        version:  "1.0",
        supportedConnectionTypes: ["fake"],
        id:       instanceOf("string")
      }, 60)
      client.handshake()
    }})

    it("puts the client in the CONNECTING state", function() { with(this) {
      stub(transport, "send")
      client.handshake()
      assertEqual( "CONNECTING", client.getState() )
    }})

    describe("on successful response", function() { with(this) {
      before(function() { with(this) {
        stubResponse({channel:    "/meta/handshake",
                      successful: true,
                      version:    "1.0",
                      supportedConnectionTypes: ["websocket"],
                      clientId:   "fakeid" })
      }})

      it("stores the clientId", function() { with(this) {
        client.handshake()
        assertEqual( "fakeid", client.getClientId() )
      }})

      it("puts the client in the CONNECTED state", function() { with(this) {
        client.handshake()
        assertEqual( "CONNECTED", client.getState() )
      }})

      it("selects a new transport based on what the server supports", function() { with(this) {
        expect(Faye.Transport, "get").given(instanceOf(Faye.Client), ["websocket"])
                                     .yielding([transport])
        client.handshake()
      }})

      it("registers any pre-existing subscriptions", function() { with(this) {
        expect(client, "subscribe").given([])
        client.handshake()
      }})
    }})

    describe("on unsuccessful response", function() { with(this) {
      before(function() { with(this) {
        stubResponse({channel:    "/meta/handshake",
                      successful: false,
                      version:    "1.0",
                      supportedConnectionTypes: ["websocket"] })
      }})

      it("schedules a retry", function() { with(this) {
        expect("setTimeout")
        client.handshake()
      }})

      it("puts the client in the UNCONNECTED state", function() { with(this) {
        stub("setTimeout")
        client.handshake()
        assertEqual( "UNCONNECTED", client.getState() )
      }})
    }})
  }})
  
  describe("subscribe", function() { with(this) {
    before(function() { with(this) {
      createConnectedClient()
      this.subscribeMessage = {
          channel:      "/meta/subscribe",
          clientId:     "fakeid",
          subscription: "/foo",
          id:           instanceOf("string")
        }
    }})
    
    describe("with no prior subscriptions", function() { with(this) {
      it("sends a subscribe message to the server", function() { with(this) {
        expect(transport, "send").given(subscribeMessage, 60)
        client.subscribe("/foo")
      }})
      
      // The Bayeux spec says the server should accept a list of subscriptions
      // in one message but the cometD server doesn't actually support this
      it("sends multiple subscribe messages if given an array", function() { with(this) {
        expect(transport, "send").given({
          channel:      "/meta/subscribe",
          clientId:     "fakeid",
          subscription: "/foo",
          id:           instanceOf("string")
        }, 60)
        expect(transport, "send").given({
          channel:      "/meta/subscribe",
          clientId:     "fakeid",
          subscription: "/bar",
          id:           instanceOf("string")
        }, 60)
        client.subscribe(["/foo", "/bar"])
      }})
      
      describe("on successful response", function() { with(this) {
        before(function() { with(this) {
          stubResponse({channel:      "/meta/subscribe",
                        successful:   true,
                        clientId:     "fakeid",
                        subscription: "/foo/*" })
        }})
        
        it("sets up a listener for the subscribed channel", function() { with(this) {
          var message
          client.subscribe("/foo/*", function(m) { message = m })
          client.receiveMessage({channel: "/foo/bar", data: "hi"})
          assertEqual( "hi", message )
        }})
        
        it("does not call the listener for non-matching channels", function() { with(this) {
          var message
          client.subscribe("/foo/*", function(m) { message = m })
          client.receiveMessage({channel: "/bar", data: "hi"})
          assertEqual( undefined, message )
        }})
      }})
      
      describe("on unsuccessful response", function() { with(this) {
        before(function() { with(this) {
          stubResponse({channel:      "/meta/subscribe",
                        successful:   false,
                        clientId:     "fakeid",
                        subscription: "/foo/*" })
        }})
        
        it("does not set up a listener for the subscribed channel", function() { with(this) {
          var message
          client.subscribe("/foo/*", function(m) { message = m })
          client.receiveMessage({channel: "/foo/bar", data: "hi"})
          assertEqual( undefined, message )
        }})
      }})
    }})
    
    describe("with an existing subscription", function() { with(this) {
      before(function() { with(this) {
        subscribe(client, "/foo/*")
      }})
      
      it("does not send another subscribe message to the server", function() { with(this) {
        expect(transport, "send").given(subscribeMessage, 60).exactly(0)
        client.subscribe("/foo/*")
      }})
      
      it("sets up another listener on the channel", function() { with(this) {
        client.subscribe("/foo/*", function() { subsCalled += 1 })
        client.receiveMessage({channel: "/foo/bar", data: "hi"})
        assertEqual( 2, subsCalled )
      }})
    }})
  }})
  
  describe("unsubscribe", function() { with(this) {
    before(function() { with(this) {
      createConnectedClient()
      this.unsubscribeMessage = {
          channel:      "/meta/unsubscribe",
          clientId:     "fakeid",
          subscription: "/foo/*",
          id:           instanceOf("string")
        }
    }})
    
    describe("with no subscriptions", function() { with(this) {
      it("does not send an unsubscribe message to the server", function() { with(this) {
        expect(transport, "send").given(unsubscribeMessage, 60).exactly(0)
        client.unsubscribe("/foo/*")
      }})
    }})
    
    describe("with a single subscription", function() { with(this) {
      before(function() { with(this) {
        this.message  = null
        this.listener = function(m) { message = m }
        subscribe(client, "/foo/*", listener)
      }})
      
      it("sends an unsubscribe message to the server", function() { with(this) {
        expect(transport, "send").given(unsubscribeMessage, 60)
        client.unsubscribe("/foo/*")
      }})
      
      it("removes the listener from the channel", function() { with(this) {
        client.receiveMessage({channel: "/foo/bar", data: "first"})
        client.unsubscribe("/foo/*", listener)
        client.receiveMessage({channel: "/foo/bar", data: "second"})
        assertEqual( "first", message )
      }})
    }})
    
    describe("with multiple subscriptions to the same channel", function() { with(this) {
      before(function() { with(this) {
        var messages = []
        this.hey = function(msg) { messages.push("hey " + message.text) }
        this.bye = function(msg) { messages.push("bye " + message.text) }
        subscribe(client, "/foo/*", hey)
        subscribe(client, "/foo/*", bye)
      }})
      
      it("does not send an unsubscribe message if one listener is removed", function() { with(this) {
        expect(transport, "send").given(unsubscribeMessage, 60).exactly(0)
        client.unsubscribe("/foo/*", bye)
      }})
      
      it("sends an unsubscribe message if each listener is removed", function() { with(this) {
        expect(transport, "send").given(unsubscribeMessage, 60)
        client.unsubscribe("/foo/*", bye)
        client.unsubscribe("/foo/*", hey)
      }})
      
      it("sends an unsubscribe message if all listeners are removed", function() { with(this) {
        expect(transport, "send").given(unsubscribeMessage, 60)
        client.unsubscribe("/foo/*")
      }})
    }})
    
    describe("with multiple subscriptions to different channels", function() { with(this) {
      before(function() { with(this) {
        subscribe(client, "/foo")
        subscribe(client, "/bar")
      }})
      
      it("sends multiple unsubscribe messages if given an array", function() { with(this) {
        expect(transport, "send").given({
          channel:      "/meta/unsubscribe",
          clientId:     "fakeid",
          subscription: "/foo",
          id:           instanceOf("string")
        }, 60)
        expect(transport, "send").given({
          channel:      "/meta/unsubscribe",
          clientId:     "fakeid",
          subscription: "/bar",
          id:           instanceOf("string")
        }, 60)
        client.unsubscribe(["/foo", "/bar"])
      }})
    }})
  }})
  
  describe("disconnect", function() { with(this) {
    before(function() { this.createConnectedClient() })
    
    it("sends a disconnect message to the server", function() { with(this) {
      expect(transport, "send").given({
        channel:  "/meta/disconnect",
        clientId: "fakeid",
        id:       instanceOf("string")
      }, 60)
      client.disconnect()
    }})
    
    it("puts the client in the DISCONNECTED state", function() { with(this) {
      client.disconnect()
      assertEqual( "DISCONNECTED", client.getState() )
    }})
  }})
}})
