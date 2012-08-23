/*
 * File:   Pokemon.h
 * Author: Brian
 *
 * Created on July 15, 2012, 1:49 AM
 */

#ifndef POKEMON_H
#define	POKEMON_H
#include "Actor.h"
#include <libtcod/libtcod.hpp>
#include <string>

class Pokemon: public Actor {
public:
    Pokemon(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk, string key);
    virtual ~Pokemon();
private:
    int weight;
    int atk;
    int spatk;
    int def;
    int spdef;
    int spd; //movespd? atkspd?
    int hp;
    int hunger;
    bool haslimbs;
    bool isfriendly;
    bool canfly;
    //state status
    //element element
    //ai type
    //vector item inventory
    //vector item equipped
    //move
    //mannerism

};

#endif	/* POKEMON_H */

