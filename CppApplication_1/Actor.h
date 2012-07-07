/* 
 * File:   Actor.h
 * Author: Brian
 *
 * Created on June 17, 2012, 1:50 AM
 */

#ifndef ACTOR_H
#define	ACTOR_H
#include "libtcod.hpp"
#include "Drawable.h"


class Actor: public Drawable {
public:
    char* nickname;
    char* name;
    Actor(int,int,int);
    Actor(int,int,int,TCODColor, TCODColor, bool, bool);
    Actor(int,int,int,TCODColor, TCODColor, bool, bool, char*);
    Actor(int, TCODColor,TCODColor,bool ,bool );
    void addNickname(char*);
    char* returnName();
    ~Actor();
private:

};

#endif	/* ACTOR_H */

