/* github test
 * second github test
 * File:   Actor.cpp
 * Author: Brian
 * 
 * Created on June 17, 2012, 1:50 AM
 */

#include "Actor.h"

Actor::Actor(int a,int b, int c): Drawable(a,b,c) {
    
}

Actor::Actor(int c, TCODColor d,TCODColor e,bool f,bool g) : Drawable (c,d,e,f,g) {

}

Actor::Actor(int a,int b,int c,TCODColor d, TCODColor e, bool f, bool g):Drawable(a,b,c,d,e,f,g){
    
}

Actor::Actor(int a,int b, int c, TCODColor d, TCODColor e, bool f, bool g, char* name): Drawable(a,b,c,d,e,f,g) {
    nickname = name;
 
}

void Actor::draw(){
    TCODConsole::root->putChar(x,y,c,TCOD_BKGND_SET);
}
void Actor::addNickname(char* data){
    nickname = data;
}


char* Actor::returnName(){
    return nickname;
}

Actor::~Actor() {
}

