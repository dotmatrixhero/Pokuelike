/* github test
 * File:   Actor.cpp
 * Author: Brian
 * 
 * Created on June 17, 2012, 1:50 AM
 */

#include "Actor.h"

Actor::Actor(int a,int b, int c): Drawable(a,b,c) {
    x = a;
    y = b;
    z= c;
    
}

Actor::Actor(int c, TCODColor d,TCODColor e,bool f,bool g) : Drawable (c,d,e,f,g) {
     x=0;//temp
     y=8;//temp

}

Actor::Actor(int a,int b,int c,TCODColor d, TCODColor e, bool f, bool g):Drawable(a,b,c,d,e,f,g){
    
}

Actor::Actor(int a,int b, int c, TCODColor d, TCODColor e, bool f, bool g, char* name): Drawable(a,b,c,d,e,f,g) {
    x = a;
    y = b;
    z= c;
    nickname = name;
 
}

void Actor::addNickname(char* data){
    nickname = data;
}


char* Actor::returnName(){
    if (nickname == NULL)
         nickname = "Doofus";    
    return nickname;
}

Actor::~Actor() {
}

