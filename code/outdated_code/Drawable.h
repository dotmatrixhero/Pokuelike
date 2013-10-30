/*
 * File:   Drawable.h
 * Author: Brian
 *
 * Created on June 16, 2012, 9:29 PM
 */

#ifndef DRAWABLE_H
#define	DRAWABLE_H

#include <libtcod/libtcod.hpp>
#include <iostream>
#include <string>
using namespace std;

class Drawable {
    protected:
        int x;
        int y;
        int c;
        int currentc;
        TCODColor fore;
        TCODColor back;
        bool trans;
        bool walk;
        string key;
        static const int mapw = 50;
        static const int maph = 40;

    public:
        Drawable(int x, int y, int c);
        Drawable(int c, TCODColor fore,TCODColor back, bool trans, bool walk);
        Drawable(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk, string type);
        virtual ~Drawable();

        void setX(int x);
        void setC(int c);
        void setY(int y);

        // Movement
        virtual bool moveRight();
        virtual bool moveLeft();
        virtual bool moveDown();
        virtual bool moveUp();
        bool moveUpLeft();
        bool moveDownLeft();
        bool moveUpRight();
        bool moveDownRight();
        virtual void setKey(string);
        void setCurrentC(int curr);
        virtual string returnkey();
        virtual void draw(TCODConsole* ConsoleMap);
        virtual void drawWashed(TCODConsole* ConsoleMap);
        // Getters
        int returnx();
        int returny();
        int returnc();
        int returncurrentc();
        TCODColor returnfore();
        TCODColor returnback();
        bool returnwalk();
        bool returntrans();
};

#endif	/* DRAWABLE_H */

